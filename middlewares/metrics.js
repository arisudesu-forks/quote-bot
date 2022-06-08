const client = require('prom-client')

const http = require('http')

const prefix = (s) => `quotly_${s}`

const buckets = [
  0.001,
  0.0025,
  0.005,
  0.01,
  0.025,
  0.05,
  0.1,
  0.25,
  0.5,
  1,
  2.5,
  5,
  10
]

const metrics = {
  process_update: new client.Histogram({
    name: prefix('process_update'),
    help: prefix('process_update'),
    buckets
  }),
  api_latency: new client.Histogram({
    name: prefix('api_latency'),
    help: prefix('api_latency'),
    buckets,
    labelNames: ['method']
  })
}

http.createServer((req, res) => {
  if (req.url === '/metrics') {
    res.writeHead(200, { 'Content-Type': client.register.contentType })
    res.write(client.register.metrics())
  }
  res.end()
}).listen(process.env.METRICS_PORT)

const measureProcessUpdate = async (ctx, next) => {
  const end = metrics.process_update.startTimer()
  return next().then(() => end())
}

const measureApiLatency = async (ctx, next) => {
  ctx.telegram.oCallApi = ctx.telegram.callApi
  ctx.telegram.callApi = (method, data = {}) => {
    const end = metrics.api_latency.startTimer({ method: method })
    return ctx.telegram.oCallApi(method, data).then((result) => {
      end()
      return result
    })
  }
  return next()
}

module.exports = {
  measureProcessUpdate,
  measureApiLatency
}
