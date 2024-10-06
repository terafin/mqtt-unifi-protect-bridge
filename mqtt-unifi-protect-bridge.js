// Requirements

import { ProtectApi } from "unifi-protect"
import util from "node:util"

import { default as mqtt } from "mqtt"
import { default as _ } from "lodash"
import { default as logging } from "homeautomation-js-lib/logging.js"
import { default as health } from "homeautomation-js-lib/health.js"
import { default as mqtt_helpers } from "homeautomation-js-lib/mqtt_helpers.js"

const username = process.env.USERNAME
const password = process.env.PASSWORD
var protectURL = process.env.PROTECT_URL

// TODO: Does this library handle this fully?
var authenticate_poll_time = process.env.AUTH_POLL_FREQUENCY

if (_.isNil(authenticate_poll_time)) {
    authenticate_poll_time = 60 * 60
}

var shouldRetain = process.env.MQTT_RETAIN

if (_.isNil(shouldRetain)) {
    shouldRetain = true
}

var mqttOptions = { qos: 1 }

if (!_.isNil(shouldRetain)) {
    mqttOptions['retain'] = shouldRetain
}

// // Config
const baseTopic = process.env.TOPIC_PREFIX

if (_.isNil(baseTopic)) {
    logging.warn('TOPIC_PREFIX not set, not starting')
    process.abort()
}

if (_.startsWith(protectURL)) {
    logging.warn('PROTECT_URL not set, not starting')
    process.abort()
} else if (_.startsWith(protectURL, 'https://') || _.startsWith(protectURL, 'http://')) {
    protectURL = _.split(protectURL, '//')[1]
}

var connectedEvent = function () {
    const subscriptionTopic = mqtt_helpers.generateTopic(baseTopic) + '/+/+/set'
    logging.info('subscribing to: ' + subscriptionTopic)
    client.subscribe(subscriptionTopic, { qos: 1 })
    health.healthyEvent()
}

var disconnectedEvent = function () {
    health.unhealthyEvent()
}


// // Setup MQTT
var client = mqtt_helpers.setupClient(connectedEvent, disconnectedEvent)

// Create a new Protect API instance.
const ufp = new ProtectApi()

// Set a listener to wait for the bootstrap event to occur.
ufp.once("bootstrap", (bootstrapJSON) => {
    // Once we've bootstrapped the Protect controller, output the bootstrap JSON and we're done.
    // process.stdout.write(util.inspect(bootstrapJSON, { colors: true, depth: null, sorted: true }) + "\n", () => process.exit(0))
});

// Login to the Protect controller.
if (!(await ufp.login(protectURL, username, password))) {

    console.log("Invalid login credentials.")
    process.exit(0)
};

// Bootstrap the controller. It will emit a message once it's received the bootstrap JSON, or you can alternatively wait for the promise to resolve.
if (!(await ufp.getBootstrap())) {

    console.log("Unable to bootstrap the Protect controller.")
    process.exit(0)
}

ufp.on("message", (packet) => {
    const action = packet.header.action
    const model = packet.header.modelKey
    const payload = packet.payload
    const id = packet.header.id

    const ring = payload.ring
    const lastMotion = payload.lastMotion
    const lastRing = payload.lastRing
    const motion = payload.motion
    const isSmartDetected = payload.isSmartDetected
    const smartDetectZone = payload.smartDetectZone
    const smartDetectTypes = payload.smartDetectTypes

    logging.debug("Action: " + action + "  model: " + model)
    if (model == "smartDetectObject" && 0) { // Disabled for now
        var camera_name = null
        const bootstrap = ufp.bootstrap
        const cameras = bootstrap.cameras
        cameras.forEach(camera_record => {
            if (camera_record.id == id) {
                camera_name = camera_record.name.toLowerCase()
            }
        })
        const type = packet.body.type

        logging.info("smart detect packet: " + JSON.stringify(packet))
        logging.info("camera: " + camera_name + "  detected: " + type)
        //                 if (type == 'smartDetectZone') {
        //                     smartDetectTypes.forEach(detected_type => {
        //                         client.smartPublish(mqtt_helpers.generateTopic(baseTopic, camera_name, detected_type), '1', mqttOptions)

        //                         setTimeout(() => {
        //                             client.smartPublish(mqtt_helpers.generateTopic(baseTopic, camera_name, detected_type), '0', mqttOptions)
        //                         }, (threshold * 1000 * 2));
        //                     });
        //                 }

    }
    if (model == "camera") {
        var camera_name = null
        const bootstrap = ufp.bootstrap
        const cameras = bootstrap.cameras
        cameras.forEach(camera_record => {
            if (camera_record.id == id) {
                camera_name = camera_record.name.toLowerCase()
            }
        })

        logging.debug("Action: " + action + "  model: " + model)
        logging.debug("id: " + id)
        logging.debug("name: " + camera_name)
        logging.debug("lastMotion: " + lastMotion)
        logging.debug("ring: " + ring)
        logging.debug("lastRing: " + lastRing)
        logging.debug("isSmartDetected: " + isSmartDetected)
        logging.debug("motion: " + motion)
        logging.debug("smartDetectZone: " + smartDetectZone)
        logging.debug("smartDetectZone: " + smartDetectTypes)

        const isMotionDetected = isSmartDetected || lastMotion
        client.smartPublish(mqtt_helpers.generateTopic(baseTopic, camera_name), isMotionDetected ? '1' : '0', mqttOptions)

        // TODO: Check to see if the device supports ringing before publishing this
        client.smartPublish(mqtt_helpers.generateTopic(baseTopic, camera_name, 'ringing'), lastRing ? '1' : '0', mqttOptions)
        // TODO: this should be offline/online
        // client.smartPublish(mqtt_helpers.generateTopic(baseTopic, camera_name, 'state'), mqtt_helpers.generateTopic(state), mqttOptions)
    }
})