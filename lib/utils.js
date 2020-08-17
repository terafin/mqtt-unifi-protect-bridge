const protectURL = process.env.PROTECT_URL

module.exports.generateURL = function(suffix) {
    return '' + protectURL + suffix
}