'use strict'
var AWS = require('aws-sdk')
var validate = require('./validate')
var readline = require('readline')

function copy(values, fn) {

  try {
    validate.config(values)
  } catch (err) {
    return fn(err, {
      count: 0,
      status: 'FAIL'
    })
  }

  var options = {
    config: values.config,
    source: {
      tableName: values.source.tableName,
      dynamoClient: values.source.dynamoClient || new AWS.DynamoDB.DocumentClient(values.source.config || values.config),
      dynamodb: values.source.dynamodb || new AWS.DynamoDB(values.source.config || values.config),
      active: values.source.active
    },
    destination: {
      tableName: values.destination.tableName,
      dynamoClient: values.destination.dynamoClient || new AWS.DynamoDB.DocumentClient(values.destination.config || values.config),
      dynamodb: values.destination.dynamodb || new AWS.DynamoDB(values.destination.config || values.config),
      active:values.destination.active,
      createTableStr : 'Creating Destination Table '
    },
    key: values.key,
    counter: values.counter || 0,
    retries: 0,
    data: {},
    log: values.log,
    create : values.create
  }

  if(options.source.active && options.destination.active){ // both tables are active
    return startCopying(options,fn)
  }

  if(options.create){ // create table if not exist
    return options.source.dynamodb.describeTable({TableName : options.source.tableName},function(err,data){
      if(err){
        return fn(err,data)
      }
      options.source.active = true
      data.Table.TableName = options.destination.tableName

      existDestinationTable(options,function(err,exist){
        if(err) {
          return fn(err)
        } else if(!exist) {
          options.destination.dynamodb.createTable(clearTableSchema(data.Table, values.encrypt),function(err){
            if(err && err.code !== 'ResourceInUseException'){
              return fn(err,data)
            }
            waitForActive(options,fn)
            // wait for TableStatus to be ACTIVE
          })
        } else {
          return fn(new Error("table " + options.destination.tableName + " exist in destination"))
        }
      })
    })
  }

  checkTables(options,function(err,data){ // check if source and destination table exist
    if(err){
      return fn(err,data)
    }
    startCopying(options,fn)
  })

}

function existDestinationTable(options, callback){
  return options.destination.dynamodb.describeTable({TableName : options.destination.tableName},function(err){
    if(err){
      if(err.code === 'ResourceNotFoundException') {
        return callback(null,false)
      } else {
        throw err
      }
    }
    return callback(null,true)
  })
}

function clearTableSchema(table, encrypt){

  delete table.TableStatus
  delete table.CreationDateTime
  delete table.ProvisionedThroughput.LastIncreaseDateTime
  delete table.ProvisionedThroughput.LastDecreaseDateTime
  delete table.ProvisionedThroughput.NumberOfDecreasesToday
  delete table.TableSizeBytes
  delete table.ItemCount
  delete table.TableArn
  delete table.TableId
  delete table.LatestStreamLabel
  delete table.LatestStreamArn

  if(table.LocalSecondaryIndexes && table.LocalSecondaryIndexes.length > 0){
    for(var i = 0 ; i < table.LocalSecondaryIndexes.length ; i++){
        delete table.LocalSecondaryIndexes[i].IndexStatus
        delete table.LocalSecondaryIndexes[i].ProvisionedThroughput.LastIncreaseDateTime
        delete table.LocalSecondaryIndexes[i].ProvisionedThroughput.LastDecreaseDateTime
        delete table.LocalSecondaryIndexes[i].ProvisionedThroughput.NumberOfDecreasesToday
        delete table.LocalSecondaryIndexes[i].IndexSizeBytes
        delete table.LocalSecondaryIndexes[i].ItemCount
        delete table.LocalSecondaryIndexes[i].IndexArn
        delete table.LocalSecondaryIndexes[i].LatestStreamLabel
        delete table.LocalSecondaryIndexes[i].LatestStreamArn
    }
  }


  if(table.GlobalSecondaryIndexes && table.GlobalSecondaryIndexes.length > 0){
    for(var j = 0 ; j < table.GlobalSecondaryIndexes.length ; j++){
        delete table.GlobalSecondaryIndexes[j].IndexStatus
        delete table.GlobalSecondaryIndexes[j].ProvisionedThroughput.LastIncreaseDateTime
        delete table.GlobalSecondaryIndexes[j].ProvisionedThroughput.LastDecreaseDateTime
        delete table.GlobalSecondaryIndexes[j].ProvisionedThroughput.NumberOfDecreasesToday
        delete table.GlobalSecondaryIndexes[j].IndexSizeBytes
        delete table.GlobalSecondaryIndexes[j].ItemCount
        delete table.GlobalSecondaryIndexes[j].IndexArn
        delete table.GlobalSecondaryIndexes[j].LatestStreamLabel
        delete table.GlobalSecondaryIndexes[j].LatestStreamArn
    }
  }

  if (table.SSEDescription) {
    table.SSESpecification = {
      Enabled: (table.SSEDescription.Status === 'ENABLED' || table.SSEDescription.Status === 'ENABLING')
    }
    delete table.SSEDescription
  }

  if(encrypt) {
    table.SSESpecification = {
      Enabled: true
    }
  }

  return table
}

function checkTables(options,fn){
  options.source.dynamodb.describeTable({TableName : options.source.tableName},function(err,sourceData){
    if(err){
      return fn(err,sourceData)
    }
    if(sourceData.Table.TableStatus !== 'ACTIVE'){
      return fn(new Error('Source table not active'),null)
    }
    options.source.active = true
    options.destination.dynamodb.describeTable({TableName : options.destination.tableName},function(err,destData){
      if(err){
        return fn(err,destData)
      }
      if(destData.Table.TableStatus !== 'ACTIVE'){
        return fn(new Error('Destination table not active'),null)
      }
      options.destination.active = true
      fn(null)
    })
  })
}

function waitForActive(options,fn){
  setTimeout(function(){
    options.destination.dynamodb.describeTable({TableName : options.destination.tableName},function(err,data){
      if(err){
        return fn(err,data)
      }
      if (options.log) {
        options.destination.createTableStr += '.'
        readline.clearLine(process.stdout)
        readline.cursorTo(process.stdout, 0)
        process.stdout.write(options.destination.createTableStr)
      }
      if(data.Table.TableStatus !== 'ACTIVE'){ // wait for active
        return waitForActive(options,fn)
      }
      options.create = false
      options.destination.active = true

      // copy tags
      options.destination.dynamodb.listTagsOfResource({ResourceArn: data.Table.TableArn}, function(err, data) {
        if(err){
          return fn(err,data)
        }
        options.destination.dynamodb.tagResource({
          ResourceArn: data.Table.TableArn,
          Tags: data.Tags
        }, function(err, data) {
          if(err){
            return fn(err,data)
          }
          startCopying(options,fn)
        });
      });
      
    })
  },1000) // check every second
}

function startCopying(options,fn){
  getItems(options, function (err, data) {
    if (err) {
      return fn(err)
    }
    options.data = data
    options.key = data.LastEvaluatedKey
    putItems(options, function (err) {
      if (err) {
        return fn(err)
      }

      if (options.log) {
        readline.clearLine(process.stdout)
        readline.cursorTo(process.stdout, 0)
        process.stdout.write('Copied ' + options.counter + ' items')
      }

      if (options.key === undefined) {
        return fn(err, {
          count: options.counter,
          status: 'SUCCESS'
        })
      }
      copy(options, fn)
    })
  })
}

function getItems(options, fn) {
  scan(options, function (err, data) {
    if (err) {
      return fn(err,data)
    }
    fn(err, mapItems(data))
  })
}


function scan(options, fn) {
  options.source.dynamoClient.scan({
    TableName: options.source.tableName,
    Limit: 25,
    ExclusiveStartKey: options.key
  }, fn)
}

function mapItems(data) {
  data.Items = data.Items.map(function (item) {
    return {
      PutRequest: {
        Item: item
      }
    }
  })
  return data
}

function putItems(options, fn) {
  if (!options.data.Items || options.data.Items.length === 0) {
    return fn(null, options)
  }
  var batchWriteItems = {}
  batchWriteItems.RequestItems = {}
  batchWriteItems.RequestItems[options.destination.tableName] = options.data.Items
  options.destination.dynamoClient.batchWrite(batchWriteItems, function (err, data) {
    if (err) {
      return fn(err,data)
    }
    var unprocessedItems = data.UnprocessedItems[options.destination.tableName]
    if (unprocessedItems !== undefined) {

      options.retries++
        options.counter += (options.data.Items.length - unprocessedItems.length)

      options.data = {
        Items: unprocessedItems
      }
      return setTimeout(function () {
        putItems(options, fn)
      }, 2 * options.retries * 100) // from aws http://docs.aws.amazon.com/general/latest/gr/api-retries.html

    }
    options.retries = 0
    options.counter += options.data.Items.length
    fn(err, options)
  })
}

module.exports.copy = copy
