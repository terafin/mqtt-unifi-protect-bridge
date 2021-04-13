// Requirements
const mqtt = require('mqtt')
const _ = require('lodash')
const logging = require('homeautomation-js-lib/logging.js')
const health = require('homeautomation-js-lib/health.js')
const mqtt_helpers = require('homeautomation-js-lib/mqtt_helpers.js')
const got = require('got')
const interval = require('interval-promise')
const analysis = require('./lib/analysis')
const authentication = require('./lib/auth.js')
const protect = require('./lib/protect.js')
const utils = require('./lib/utils.js')

const username = process.env.USERNAME
const password = process.env.PASSWORD

authentication.setAccount(username, password)

var authenticate_poll_time = process.env.AUTH_POLL_FREQUENCY

if (_.isNil(authenticate_poll_time)) {
    authenticate_poll_time = 60 * 60
}

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
    const subscriptionTopic = mqtt_helpers.generateTopic(baseTopic) + '/+/+/set'
    logging.info('subscribing to: ' + subscriptionTopic)
    client.subscribe(subscriptionTopic, { qos: 1 })
    health.healthyEvent()
}

var disconnectedEvent = function() {
    health.unhealthyEvent()
}


// Setup MQTT
var client = mqtt_helpers.setupClient(connectedEvent, disconnectedEvent)

var analysisMap = {}
var lastCameras = null

async function pollBootstrap() {
    try {
        const body = await protect.getAPIBootstrap()
        logging.debug('body: ' + JSON.stringify(body))
        const cameras = body.cameras
        lastCameras = cameras

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
                        const imageData = await protect.getSnapshotForCamera(camera)
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

const startWatching = function() {
    logging.info('starting poll')

    interval(async() => {
        try {
            pollBootstrap()
        } catch (error) {
            logging.error('error polling: ' + error)
        }
    }, pollTime * 1000)

    interval(async() => {
        logging.info(' => polling auth')
        await authentication.authenticate()
    }, authenticate_poll_time * 1000)
}


client.on('message', (topic, message) => {
    logging.info(' => ' + topic + ':' + message)
    const components = topic.split('/')
    const name = components[components.length - 3]
    const command = components[components.length - 2]
    switch (command) {
        case 'message':
            if (!_.isNil(lastCameras)) {
                logging.info('Looking for camera name: ' + name)

                for (const camera of lastCameras) {
                    const camera_name = mqtt_helpers.generateTopic(camera.name)

                    if (name == camera_name)
                        protect.updateDoorbellMessage(camera, message.toString())
                }
            }

            break
        default:
            logging.warn('Unhandled command: ' + command)
            break

    }
})

startWatching()