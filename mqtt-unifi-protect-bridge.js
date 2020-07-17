// Requirements
const mqtt = require('mqtt')
const _ = require('lodash')
const logging = require('homeautomation-js-lib/logging.js')
const health = require('homeautomation-js-lib/health.js')
const mqtt_helpers = require('homeautomation-js-lib/mqtt_helpers.js')
const request = require('request')
const repeat = require('repeat')

const API_AUTH_URL_SUFFIX = '/api/auth'
const API_ACCESS_KEY_URL_SUFFIX = '/api/auth/access-key'
const API_BOOTSTRAP_SUFFIX = '/api/bootstrap'

process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = 0

const username = process.env.USERNAME
const password = process.env.PASSWORD
const protectURL = process.env.PROTECT_URL

var lastAccessToken = null

var pollTime = process.env.POLL_FREQUENCY

if ( _.isNil(pollTime) ) {
	pollTime = 1
}

var shouldRetain = process.env.MQTT_RETAIN

if (_.isNil(shouldRetain)) {
	shouldRetain = true
}

var mqttOptions = {qos: 1}

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

const getAPIBootstrap = function(callback) {
	
	const authenticatedAction = function() {
		const bootstrapURL = generateURL(API_BOOTSTRAP_SUFFIX)

		logging.debug('api bootstrap request url: ' + bootstrapURL)

		request.get(bootstrapURL, {'auth': {'bearer': lastAccessToken}, json: true},

			function(err, httpResponse, body) {
				if ( !_.isNil(err)) { 
					logging.error('error:' + err) 
					logging.error('body:' + JSON.stringify(body))
				} else {
					logging.debug('body:' + JSON.stringify(body))
				}

				if (callback !== null && callback !== undefined) {
					return callback(err, body)
				}
			})
	}

	if ( _.isNil(lastAccessToken)) {
		authenticate( function(err, accessToken) {
			authenticatedAction()
		})
	} else {
		authenticatedAction()
	}
}


const authenticate = function(callback) {
	const authURL = generateURL(API_AUTH_URL_SUFFIX)
	logging.info('oauth request url: ' + authURL)

	request.post(authURL, {form: {grant_type: 'password', username: username, password: password}, json: true},
		function(err, httpResponse, body) {
			if ( !_.isNil(err)) { 
				logging.error('error:' + err) 
				logging.error('body:' + JSON.stringify(body))
			} else {
				logging.debug('body:' + JSON.stringify(body))
			}

			const accessToken = httpResponse.headers.authorization
			logging.info('accessToken:' + accessToken)

			if ( !_.isNil(accessToken)) {
				lastAccessToken = accessToken 
			} else {
				logging.error(' no access token loaded - bad auth?')
			}

			if (callback !== null && callback !== undefined) {
				return callback(err, accessToken)
			}
		}).auth(username, password, true)
}



// Setup MQTT
var client = mqtt_helpers.setupClient(connectedEvent, disconnectedEvent)



const hitBootstrapURL = function() {
	getAPIBootstrap( function(err, body) {
		const cameras = body.cameras
		cameras.forEach(camera => {
			const name = camera.name
			const state = camera.state
			const isMotionDetected = camera.isMotionDetected

			if ( isMotionDetected ) {
				logging.info('** camera motion:') 
				logging.info('            name: ' + name)
				logging.info('           state: ' + state)
				logging.info('          motion: ' + isMotionDetected)

			}
			client.smartPublish(mqtt_helpers.generateTopic(baseTopic, name, 'state'), mqtt_helpers.generateTopic(state), mqttOptions)
			client.smartPublish(mqtt_helpers.generateTopic(baseTopic, name), isMotionDetected ? '1' : '0', mqttOptions)
		})
	})


}
const startWatching = function() {
	logging.info('starting poll')
	repeat(hitBootstrapURL).every(pollTime, 's').start.in(1, 'sec')
}

startWatching()
