// Requirements
const mqtt = require('mqtt')
const _ = require('lodash')
const logging = require('homeautomation-js-lib/logging.js')
const health = require('homeautomation-js-lib/health.js')
const mqtt_helpers = require('homeautomation-js-lib/mqtt_helpers.js')
const got = require('got')
const request = require('request')
const repeat = require('repeat')
const fetch = require('node-fetch');

const API_AUTH_URL_SUFFIX = '/api/auth'
const API_ACCESS_KEY_URL_SUFFIX = '/api/auth/access-key'
const API_BOOTSTRAP_SUFFIX = '/api/bootstrap'

process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = 0

const username = process.env.USERNAME
const password = process.env.PASSWORD
const protectURL = process.env.PROTECT_URL
const score_threshold = 0.7

var lastAccessToken = null
var lastAccessKey = null

var pollTime = process.env.POLL_FREQUENCY

const compression = require("compression")
const tf = require('@tensorflow/tfjs-node')
const cocoSsd = require('@tensorflow-models/coco-ssd')

if (_.isNil(pollTime)) {
    pollTime = 1
}

var shouldRetain = process.env.MQTT_RETAIN

if (_.isNil(shouldRetain)) {
    shouldRetain = true
}

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
    return protectURL + suffix
}

async function getAPIBootstrap() {

    const authenticatedAction = function() {
        const bootstrapURL = generateURL(API_BOOTSTRAP_SUFFIX)

        logging.debug('api bootstrap request url: ' + bootstrapURL)

    }

    if (_.isNil(lastAccessToken)) {
        await authenticate()
    }

    const bootstrapURL = generateURL(API_BOOTSTRAP_SUFFIX)
    var bootstrap_body = null


    try {
        const response = await request.get(bootstrapURL, { 'auth': { 'bearer': lastAccessToken }, json: true })
        logging.info('response: ' + JSON.stringify(response))
        logging.info('response.body: ' + JSON.stringify(response.body))
        bootstrap_body = JSON.parse(response.body)
    } catch (error) {
        logging.error('get api bootstrap failed: ' + error)
        throw ('getAPIBootstrap error ' + error)
    }

    return bootstrap_body
}


async function authenticate() {
    const authURL = generateURL(API_AUTH_URL_SUFFIX)
    logging.info('oauth request url: ' + authURL)

    try {
        const response = await request.post(authURL, { form: { grant_type: 'password', username: username, password: password }, json: true }).auth(username, password, true)
        const body = response.body
        const headers = response.headers
        const accessToken = headers.authorization
        logging.info('accessToken: ' + accessToken)
        if (!_.isNil(accessToken)) {
            lastAccessToken = accessToken
        } else {
            logging.error(' no access token loaded - bad auth?')
        }
        const accesskeyURL = generateURL(API_ACCESS_KEY_URL_SUFFIX)

        const accessKeyResponse = await request.post(accesskeyURL, { 'auth': { 'bearer': lastAccessToken }, json: true })
        lastAccessKey = JSON.parse(accessKeyResponse.body).accessKey
    } catch (error) {
        logging.error('authenticate failed: ' + error)
        throw ('authenticate error ' + error)

    }

    return accessToken
}



// Setup MQTT
var client = mqtt_helpers.setupClient(connectedEvent, disconnectedEvent)

const _snapshotURLForCamera = function(camera) {
    return generateURL('/api/cameras/' + camera.id + '/snapshot?accessKey=' + encodeURIComponent(lastAccessKey) + '&force=true')
}

const processingURLForSnapshotURL = function(snapshotURL) {
    return 'https://siliconspirit.net/nodered/check-image-url-for-objects?url=' + snapshotURL
}

const snapshotURLForCamera = function(camera) {
    return 'http://' + camera.host + '/snap.jpeg'
}

const loadSnapshotForCamera = function(camera, callback) {
    const snapshotURL = snapshotURLForCamera(camera)

    request.get(snapshotURL,
        function(err, httpResponse, body) {
            if (!_.isNil(err)) {
                logging.error('error:' + err)
                logging.error('body:' + JSON.stringify(body))
            } else {
                logging.debug('snapshot data:' + body.length)
            }

            if (!_.isNil(callback)) {
                return callback(err, body)
            }
        })

}

var pendingQueries = {}
var globalModel = null

async function loadModel() {
    if (globalModel)
        return globalModel

    try {
        globalModel = await cocoSsd.load()
    } catch (error) {
        logging.error('model loading failed: ' + error)
        throw ('loadModel error ' + error)
    }
    logging.info('Model loaded: ' + (_.isNil(globalModel) ? 'no' : 'yes'))

    return globalModel
}


async function processImageData(imageData) {
    var img = tf.node.decodeImage(imageData);
    if (_.isNil(img))
        return {}

    var model = null
    var detection_results = []

    try {
        model = await loadModel()
        detection_results = await model.detect(img, 20)
        logging.info('   detect results: ' + JSON.stringify(detection_results))
    } catch (error) {
        logging.error('failed to detect: ' + error)
        throw ('processImageData error ' + error)
    }

    var result_classes = {};

    if (!_.isNil(detection_results)) {
        for (var i = 0; i < detection_results.length; i++) {
            if (detection_results[i].score < score_threshold) {
                detection_results.splice(i, 1);
                i = i - 1;
            }
        }
        for (var j = 0; j < detection_results.length; j++) {
            result_classes[detection_results[j].class] = (result_classes[detection_results[j].class] || 0) + 1;
        }
    }

    tf.dispose(img);

    return result_classes
}

async function analyzeObjectsForCamera(camera) {
    if (!_.isNil(pendingQueries[camera.id])) {
        throw 'in flight analysis'
    }

    pendingQueries[camera.id] = camera
    const snapshotURL = snapshotURLForCamera(camera)
    const _snapshotURL = _snapshotURLForCamera(camera)
    const processingURL = processingURLForSnapshotURL(_snapshotURL)
    logging.info('   analyze objects for camera: ' + camera.name)
        // logging.info('                  snapshotURL: ' + snapshotURL)
    logging.info('                  _snapshotURL: ' + _snapshotURL)
        // logging.info('                processingURL: ' + processingURL)
        // logging.debug('   camera: ' + JSON.stringify(camera))

    var processingResult = {}

    try {
        const snapshotImageData = await fetch(_snapshotURL)
            // logging.info('                snapshotImageData: ' + JSON.stringify(snapshotImageData))
        const buffer = await snapshotImageData.buffer()
            // logging.info('                snapshotImageData: ' + buffer.length)
        processingResult = await processImageData(buffer)
        logging.info('                processingResult (' + camera.name + '): ' + JSON.stringify(processingResult))
    } catch (error) {
        logging.error('error loading and processing: ' + error)
        throw ('analyzeObjectsForCamera error: ' + error)
    }


    return processingResult
}


var analysisMap = {}

async function pollBootstrap() {
    const body = await getAPIBootstrap()
    logging.info('bootstrap body: ' + JSON.stringify(body))
    const cameras = body.cameras

    for (const camera of cameras) {
        const name = camera.name
        const state = camera.state
        const isMotionDetected = camera.isMotionDetected
        logging.debug('** camera: ' + JSON.stringify(camera))


        if (isMotionDetected || true) {
            logging.info('** camera motion:')
            logging.info('            name: ' + name)
            logging.info('           state: ' + state)
            logging.info('          motion: ' + isMotionDetected)
            if (_.isNil(pendingQueries[camera.id])) {
                const results = await analyzeObjectsForCamera(camera)
                if (!_.isNil(analysis)) {
                    logging.info('  camera analysis : ' + JSON.stringify(analysis))
                } else {
                    logging.error('failed to load analysis: ' + err)
                }

                const oldAnalysis = analysisMap[camera.id]

                if (!_.isNil(analysis)) {
                    Object.keys(analysis).forEach(key => {
                        client.smartPublish(mqtt_helpers.generateTopic(baseTopic, name, 'objects', key), '1', mqttOptions)
                    })
                }

                if (!_.isNil(oldAnalysis)) {
                    Object.keys(oldAnalysis).forEach(key => {
                        if (_.isNil(analysis[key])) {
                            client.smartPublish(mqtt_helpers.generateTopic(baseTopic, name, 'objects', key), '0', mqttOptions)
                        }
                    })
                }

                analysisMap[camera.id] = analysis
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
    repeat(hitBootstrapURL).every(pollTime, 's').start.in(1, 'sec')
}

startWatching()
loadModel()