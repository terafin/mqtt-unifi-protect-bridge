// Requirements
const mqtt = require('mqtt')
const _ = require('lodash')
const logging = require('homeautomation-js-lib/logging.js')
const health = require('homeautomation-js-lib/health.js')
const mqtt_helpers = require('homeautomation-js-lib/mqtt_helpers.js')
const got = require('got')
const interval = require('interval-promise')
const analysis = require('./lib/analysis')
const API_AUTH_URL_SUFFIX = '/api/auth'
const API_ACCESS_KEY_URL_SUFFIX = '/api/auth/access-key'
const API_BOOTSTRAP_SUFFIX = '/api/bootstrap'

process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = 0

const username = process.env.USERNAME
const password = process.env.PASSWORD
const protectURL = process.env.PROTECT_URL

var lastAccessToken = null
var lastAccessKey = null

var pollTime = process.env.POLL_FREQUENCY

if (_.isNil(pollTime)) {
    pollTime = 1
}

var shouldRetain = process.env.MQTT_RETAIN

if (_.isNil(shouldRetain)) {
    shouldRetain = true
}

const shouldDoImageAnalysis = Number(process.env.ENABLE_IMAGE_ANALYSIS)

logging.info(' * enabling image analysis: ' + shouldDoImageAnalysis)

var mqttOptions = { qos: 1 }

if (!_.isNil(shouldRetain)) {
    mqttOptions['retain'] = shouldRetain
}

// Config
const baseTopic = process.env.TOPIC_PREFIX

if (_.isNil(baseTopic)) {
    logging.warn('TOPIC_PREFIX not set, not starting')
    process.abort()
}

var connectedEvent = function() {
    health.healthyEvent()
}

var disconnectedEvent = function() {
    health.unhealthyEvent()
}

const generateURL = function(suffix) {
    return '' + protectURL + suffix
}

async function getAPIBootstrap() {
    if (_.isNil(lastAccessToken)) {
        await authenticate()
    }

    const bootstrapURL = generateURL(API_BOOTSTRAP_SUFFIX)
    var bootstrap_body = null


    try {
        // const response = await got.get(bootstrapURL, { 'auth': { 'bearer': lastAccessToken }, json: true })
        const bootstrap_response = await got.get(bootstrapURL, {
            headers: {
                'Authorization': 'Bearer ' + lastAccessToken.toString()
            }
        })

        bootstrap_body = JSON.parse(bootstrap_response.body)
    } catch (error) {
        logging.error('get api bootstrap failed: ' + error)
        throw ('getAPIBootstrap error ' + error)
    }

    return bootstrap_body
}


async function authenticate() {
    const authURL = generateURL(API_AUTH_URL_SUFFIX)
    const accesskeyURL = generateURL(API_ACCESS_KEY_URL_SUFFIX)
    var accessToken = null

    logging.info('oauth request url: ' + authURL)
    logging.debug(' accesskeyURL: ' + accesskeyURL)

    try {
        const response = await got.post(authURL, { form: { grant_type: 'password', username: username, password: password } })
        const body = response.body
        const headers = response.headers
        accessToken = headers.authorization
        logging.info('accessToken: ' + accessToken)
        if (!_.isNil(accessToken)) {
            lastAccessToken = accessToken
        } else {
            logging.error(' no access token loaded - bad auth?')
        }

        const accessKeyResponse = await got.post(accesskeyURL, {
            headers: {
                'Authorization': 'Bearer ' + accessToken.toString()
            }
        })

        lastAccessKey = JSON.parse(accessKeyResponse.body).accessKey
    } catch (error) {
        logging.error('authenticate failed: ' + error)
        throw ('authenticate error ' + error)

    }

    return accessToken
}



// Setup MQTT
var client = mqtt_helpers.setupClient(connectedEvent, disconnectedEvent)

const snapshotURLForCamera = function(camera) {
    return generateURL('/api/cameras/' + camera.id + '/snapshot?accessKey=' + encodeURIComponent(lastAccessKey) + '&force=true')
}


var analysisMap = {}

async function pollBootstrap() {
    try {
        const body = await getAPIBootstrap()
        logging.debug('body: ' + JSON.stringify(body))
        const cameras = body.cameras

        for (const camera of cameras) {
            const name = camera.name
            const state = camera.state
            const lastRing = camera.lastRing
            const lastMotion = camera.lastMotion
            const isMotionDetected = camera.isMotionDetected
            const now = new Date()
            logging.debug('** camera: ' + JSON.stringify(camera))

            if (!_.isNil(lastRing)) {
                logging.debug('** camera ring:')
                logging.debug('      lastRing: ' + lastRing)
                const ringDate = new Date(lastRing)
                logging.debug('      ringDate: ' + ringDate)
                const ringTimeDifferenceSeconds = (now - lastRing) / 1000
                logging.debug('      ringTimeDifferenceSeconds: ' + ringTimeDifferenceSeconds)

                const recentRing = (ringTimeDifferenceSeconds < pollTime * 2) ? 1 : 0
                client.smartPublish(mqtt_helpers.generateTopic(baseTopic, name, 'ringing'), recentRing ? '1' : '0', mqttOptions)
            }

            if (isMotionDetected) {
                logging.info('** camera motion:')
                logging.info('            name: ' + name)
                logging.info('           state: ' + state)
                logging.info('          motion: ' + isMotionDetected)

                if (shouldDoImageAnalysis) {
                    if (!analysis.hasPendingAnalysisForCamera(camera)) {
                        const snapshotResponse = await got.get(snapshotURLForCamera(camera))
                        const imageData = await snapshotResponse.rawBody
                        const objects = await analysis.analyzeObjectsForCamera(camera, imageData)
                        const oldAnalysis = analysisMap[camera.id]

                        if (!_.isNil(objects)) {
                            Object.keys(objects).forEach(key => {
                                client.smartPublish(mqtt_helpers.generateTopic(baseTopic, name, 'objects', key), '1', mqttOptions)
                            })
                        }

                        if (!_.isNil(oldAnalysis)) {
                            Object.keys(oldAnalysis).forEach(key => {
                                if (_.isNil(objects[key])) {
                                    client.smartPublish(mqtt_helpers.generateTopic(baseTopic, name, 'objects', key), '0', mqttOptions)
                                }
                            })
                        }

                        analysisMap[camera.id] = objects
                    }
                }
            } else {
                const oldAnalysis = analysisMap[camera.id]
                if (!_.isNil(oldAnalysis)) {
                    Object.keys(oldAnalysis).forEach(key => {
                        client.smartPublish(mqtt_helpers.generateTopic(baseTopic, name, 'objects', key), '0', mqttOptions)
                    })
                    delete analysisMap[camera.id]
                }
            }

            client.smartPublish(mqtt_helpers.generateTopic(baseTopic, name, 'state'), mqtt_helpers.generateTopic(state), mqttOptions)
            client.smartPublish(mqtt_helpers.generateTopic(baseTopic, name), isMotionDetected ? '1' : '0', mqttOptions)
        }
    } catch (error) {
        logging.error('Failed to poll bootstrap: ' + error)
    }
}

const hitBootstrapURL = function() {
    try {
        pollBootstrap()
    } catch (error) {
        logging.error('error polling: ' + error)
    }
}

const startWatching = function() {
    logging.info('starting poll')
    interval(async() => {
        hitBootstrapURL()
    }, pollTime * 1000)
}

startWatching()