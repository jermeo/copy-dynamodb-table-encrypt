'use strict'
var ConfigError = require('./error')

var validate = function (options, field) {
  if (options[field] === undefined) {
    throw new ConfigError('InvalidConfig', field + ' is required')
  }
  if (options[field].tableName === undefined) {
    throw new ConfigError('InvalidConfig', field + '.tableName is required')
  }
  if (typeof options[field].tableName !== 'string') {
    throw new ConfigError('InvalidConfig', field + '.tableName should be string')
  }
  if (options[field].tableName.length < 3 || options[field].tableName.length > 255 ) {
    throw new ConfigError('InvalidConfig', field + '.tableName length should be between 3 and 255')
  }
}

module.exports.config = function (options) {
  validate(options, 'source')
  validate(options, 'destination')
}