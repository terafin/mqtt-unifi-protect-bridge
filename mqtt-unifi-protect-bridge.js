// Requirements
const mqtt = require('mqtt')
const _ = require('lodash')
const logging = require('homeautomation-js-lib/logging.js')
const health = require('homeautomation-js-lib/health.js')
const mqtt_helpers = require('homeautomation-js-lib/mqtt_helpers.js')
const got = require('got')
const interval = require('interval-promise')
const authentication = require('./lib/auth.js')
const protect = require('./lib/protect.js')
const utils = require('./lib/utils.js')

const username = process.env.USERNAME
const password = process.env.PASSWORD

var cachedBootstrap = null

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

var lastCameras = null

// {
//     "id": "6076012103001603e701eb8f",
//     "type": "smartDetectZone",
//     "start": 1618346270231,
//     "end": 1618346277093,
//     "score": 95,
//     "smartDetectTypes": [
//         "person"
//     ],
//     "smartDetectEvents": [],
//     "camera": "5ff5204001bcb603e7000408",
//     "partition": null,
//     "thumbnail": "e-6076012103001603e701eb8f",
//     "heatmap": "e-6076012103001603e701eb8f",
//     "modelKey": "event"
// },

// {
//     "id": "6076003200bd1603e701eb74",
//     "type": "ring",
//     "start": 1618346034188,
//     "end": 1618346035188,
//     "score": 0,
//     "smartDetectTypes": [],
//     "smartDetectEvents": [],
//     "camera": "5ff5204001bcb603e7000408",
//     "partition": null,
//     "thumbnail": "e-6076003200bd1603e701eb74",
//     "heatmap": "e-6076003200bd1603e701eb74",
//     "modelKey": "event"
// },

// {
//     "id": "6075430d00ae1603e701e401",
//     "type": "motion",
//     "start": 1618297610112,
//     "end": 1618297615447,
//     "score": 18,
//     "smartDetectTypes": [],
//     "smartDetectEvents": [],
//     "camera": "5ff5204001deb603e7000409",
//     "partition": null,
//     "thumbnail": "e-6075430d00ae1603e701e401",
//     "heatmap": "e-6075430d00ae1603e701e401",
//     "modelKey": "event"
// },

async function pollEvents() {
    try {
        const events = await protect.getEvents(['ring', 'motion', 'smartDetectZone'])
        logging.debug('events: ' + JSON.stringify(events))

        const now = new Date()
        events.forEach(event => {
            const id = event.id
            const type = event.type
            const start = event.start
            const end = event.end
            const score = event.score
            const camera_id = event.camera
            const smartDetectTypes = event.smartDetectTypes
            var camera_name = id
            const startTimeSinceNow = (now.getTime() - start) / 1000
            const threshold = (Number(pollTime) + 5)

            const cameras = cachedBootstrap.cameras
            cameras.forEach(camera_record => {
                if (camera_record.id == camera_id) {
                    camera_name = camera_record.name.toLowerCase()
                }
            })

            if (startTimeSinceNow < threshold) {
                logging.info('** camera_name: ' + camera_name)
                logging.info('      event type: ' + type)
                logging.info('       threshold: ' + threshold)
                logging.info('           start: ' + start)
                logging.info('             now: ' + now.getTime())
                logging.info('           score: ' + score)
                logging.info('           startTimeSinceNow: ' + startTimeSinceNow)

                if (!_.isNil(smartDetectTypes)) {
                    logging.info('      smart types: ' + JSON.stringify(smartDetectTypes))
                }

                if (type == 'smartDetectZone') {
                    smartDetectTypes.forEach(detected_type => {
                        client.smartPublish(mqtt_helpers.generateTopic(baseTopic, camera_name, detected_type), '1', mqttOptions)

                        setTimeout(() => {
                            client.smartPublish(mqtt_helpers.generateTopic(baseTopic, camera_name, detected_type), '0', mqttOptions)
                        }, (threshold * 1000 * 2));
                    });
                }
            } else {
                // logging.info('** SKIPPING camera_name: ' + camera_name)
                // logging.info('      event type: ' + type)
                // logging.info('       threshold: ' + threshold)
                // logging.info('           start: ' + start)
                // logging.info('             now: ' + now.getTime())
                // logging.info('           score: ' + score)
                // logging.info('           startTimeSinceNow: ' + startTimeSinceNow)
            }
        })
    } catch (error) {
        logging.error('Failed to poll bootstrap: ' + error)
    }
}

async function pollBootstrap() {
    try {
        const body = await protect.getAPIBootstrap()
        logging.debug('body: ' + JSON.stringify(body))
        const cameras = body.cameras
        lastCameras = cameras
        cachedBootstrap = body

        for (const camera of cameras) {
            if (!_.isNil(camera.name)) {
                const name = camera.name.toLowerCase()
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

                client.smartPublish(mqtt_helpers.generateTopic(baseTopic, name, 'state'), mqtt_helpers.generateTopic(state), mqttOptions)
                client.smartPublish(mqtt_helpers.generateTopic(baseTopic, name), isMotionDetected ? '1' : '0', mqttOptions)
            }
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
            pollEvents()
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
                    const camera_name = mqtt_helpers.generateTopic(camera.name).toLowerCase()

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