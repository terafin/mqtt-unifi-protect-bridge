var pendingQueries = {}
var globalModel = null

const _ = require('lodash')
const tf = require('@tensorflow/tfjs-node')
const cocoSsd = require('@tensorflow-models/coco-ssd')
const logging = require('homeautomation-js-lib/logging.js')

var score_threshold = process.env.ANALYSIS_THRESHOLD

if (_.isNil(score_threshold)) {
    score_threshold = 0.7
}


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

// Load the model up!
loadModel()

async function processImageData(imageData) {
    var decodedImage = tf.node.decodeImage(imageData);

    if (_.isNil(decodedImage))
        return {}

    var results = {};

    try {
        const model = await loadModel()
        const detection_results = await model.detect(decodedImage, 40)
        logging.debug('   detection results: ' + JSON.stringify(detection_results))

        if (!_.isNil(detection_results)) {
            detection_results.forEach(result => {
                if (result.score >= score_threshold) {
                    const existing_match = results[result.class]
                    results[result.class] = Number(1) + (_.isNil(existing_match) ? Number(0) : existing_match)
                }
            })
        }
    } catch (error) {
        logging.error('failed to detect: ' + error)
        throw ('processImageData error ' + error)
    }


    tf.dispose(decodedImage);

    return results
}

async function analyzeObjectsForCamera(camera, buffer) {
    if (!_.isNil(pendingQueries[camera.id])) {
        throw 'in flight analysis'
    }

    pendingQueries[camera.id] = camera

    var processingResult = {}

    try {
        processingResult = await processImageData(buffer)
        logging.info('                processingResult (' + camera.name + '): ' + JSON.stringify(processingResult))

    } catch (error) {
        logging.error('error loading and processing: ' + error)
        throw ('analyzeObjectsForCamera error: ' + error)
    }

    delete pendingQueries[camera.id]

    return processingResult
}
module.exports.analyzeObjectsForCamera = analyzeObjectsForCamera

module.exports.hasPendingAnalysisForCamera = function(camera) {
    return !_.isNil(pendingQueries[camera.id])
}