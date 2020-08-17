const _ = require('lodash')
const logging = require('homeautomation-js-lib/logging.js')
const utils = require('./utils.js')
const got = require('got')

const API_AUTH_URL_SUFFIX = '/api/auth'
const API_ACCESS_KEY_URL_SUFFIX = '/api/auth/access-key'

var lastAccessToken = null
var lastAccessKey = null

var configuredUsername = null
var configuredPassword = null

module.exports.setAccount = function(username, password) {
    configuredUsername = username
    configuredPassword = password
}

async function authenticate() {
    const authURL = utils.generateURL(API_AUTH_URL_SUFFIX)
    const accesskeyURL = utils.generateURL(API_ACCESS_KEY_URL_SUFFIX)
    var accessToken = null

    logging.info('oauth request url: ' + authURL)
    logging.debug(' accesskeyURL: ' + accesskeyURL)

    try {
        const response = await got.post(authURL, { form: { grant_type: 'password', username: configuredUsername, password: configuredPassword } })
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

module.exports.authenticate = authenticate

async function authenticateifNeeded() {
    if (!_.isNil(lastAccessToken)) {
        return lastAccessToken
    }

    var newToken = null

    try {
        newToken = await authenticate()
    } catch (error) {
        logging.error(' failed authenticaing: ' + error)
        throw (error)
    }
    return newToken
}

module.exports.authenticateifNeeded = authenticateifNeeded

module.exports.cachedAccessToken = function() {
    return lastAccessToken
}

module.exports.cachedAccessKey = function() {
    return lastAccessKey
}

module.exports.cachedAuthHeaders = function() {
    return {
        'Authorization': 'Bearer ' + lastAccessToken.toString()
    }
}