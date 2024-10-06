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
    var id = packet.header.id

    const ring = payload.ring
    const lastMotion = payload.lastMotion
    const lastRing = payload.lastRing
    const motion = payload.motion
    const isConnected = payload.isConnected
    const isSmartDetected = payload.isSmartDetected
    const smartDetectZone = payload.smartDetectZone
    const smartDetectTypes = payload.smartDetectTypes

    logging.debug("Action: " + action + "  model: " + model)
    if (model == "event") { // Disabled for now
        var camera_name = null
        id = packet.header.recordId
        const bootstrap = ufp.bootstrap
        const cameras = bootstrap.cameras
        cameras.forEach(camera_record => {
            if (camera_record.id == id) {
                logging.debug("camera: " + JSON.stringify(camera_record))
                camera_name = camera_record.name.toLowerCase()
            }
        })
        logging.debug("event detect packet: " + JSON.stringify(packet))
        const types = packet.payload.smartDetectTypes
        if (!_.isNil(camera_name) && !_.isNil(types)) {
            types.forEach(type => {
                logging.debug("camera: " + camera_name + "  detected: " + type)
                client.smartPublish(mqtt_helpers.generateTopic(baseTopic, camera_name, type), '1', mqttOptions)

                setTimeout(() => {
                    client.smartPublish(mqtt_helpers.generateTopic(baseTopic, camera_name, type), '0', mqttOptions)
                }, (1000 * 5));
            });
        }
    } else if (model == "camera") {
        var camera_name = null
        const bootstrap = ufp.bootstrap
        var camera_supports_doorbell = false
        const cameras = bootstrap.cameras
        cameras.forEach(camera_record => {
            if (camera_record.id == id) {
                camera_name = camera_record.name.toLowerCase()
                camera_supports_doorbell = camera_record.featureFlags.isDoorbell
            }
        })

        logging.debug("Action: " + action + "  model: " + model)
        logging.debug("camera packet: " + JSON.stringify(packet))
        logging.debug("id: " + id)
        logging.debug("name: " + camera_name)
        logging.debug("lastMotion: " + lastMotion)
        logging.debug("ring: " + ring)
        logging.debug("lastRing: " + lastRing)
        logging.debug("isSmartDetected: " + isSmartDetected)
        logging.debug("isConnected: " + isConnected)

        logging.debug("motion: " + motion)
        logging.debug("smartDetectZone: " + smartDetectZone)
        logging.debug("smartDetectTypes: " + smartDetectTypes)

        const isMotionDetected = isSmartDetected || lastMotion
        client.smartPublish(mqtt_helpers.generateTopic(baseTopic, camera_name), isMotionDetected ? '1' : '0', mqttOptions)

        if (camera_supports_doorbell)
            client.smartPublish(mqtt_helpers.generateTopic(baseTopic, camera_name, 'ringing'), lastRing ? '1' : '0', mqttOptions)
    }
})