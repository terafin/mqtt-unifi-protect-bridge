const _ = require('lodash')
const logging = require('homeautomation-js-lib/logging.js')
const authentication = require('./auth.js')
const utils = require('./utils.js')
const got = require('got')
const API_CAMERA_PATCH = '/api/cameras/'
const API_BOOTSTRAP_SUFFIX = '/api/bootstrap'

process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = 0

var localUsername = null
var localPassword = null

const snapshotURLForCamera = function(camera) {
    return utils.generateURL('/api/cameras/' + camera.id + '/snapshot?accessKey=' + encodeURIComponent(authentication.cachedAccessKey()) + '&force=true')
}


async function getAPIBootstrap() {
    await authentication.authenticateifNeeded()

    const bootstrapURL = utils.generateURL(API_BOOTSTRAP_SUFFIX)
    var bootstrap_body = null

    try {
        const bootstrap_response = await got.get(bootstrapURL, {
            headers: {
                ...authentication.cachedAuthHeaders()
            }
        })

        bootstrap_body = JSON.parse(bootstrap_response.body)
    } catch (error) {
        logging.error('get api bootstrap failed: ' + error)
        throw ('getAPIBootstrap error ' + error)
    }

    return bootstrap_body
}

module.exports.getAPIBootstrap = getAPIBootstrap

async function updateDoorbellMessage(camera, message) {
    await authentication.authenticateifNeeded()

    const cameraPatchURL = utils.generateURL(API_CAMERA_PATCH) + camera.id
    var resultBody = null
    const patchJSON = {
        lcdMessage: {
            type: "CUSTOM_MESSAGE",
            text: message
        }
    }

    logging.info('sending patch to url: ' + cameraPatchURL + '   patch: ' + JSON.stringify(patchJSON))
    try {
        const response = await got.patch(cameraPatchURL, {
            headers: {
                ...authentication.cachedAuthHeaders()
            },
            json: patchJSON
        })

        resultBody = JSON.parse(response.body)
    } catch (error) {
        logging.error('update patch failed: ' + error)
        throw ('updateDoorbellMessage error ' + error)
    }

    return resultBody
}

module.exports.updateDoorbellMessage = updateDoorbellMessage

async function getSnapshotForCamera(camera) {
    const snapshotResponse = await got.get(snapshotURLForCamera(camera))
    const imageData = await snapshotResponse.rawBody

    return imageData
}

module.exports.getSnapshotForCamera = getSnapshotForCamera