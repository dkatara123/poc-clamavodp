const net = require('net');
const Transform = require('stream').Transform;
/**
 * ClamAVWrapper Class
 */
class ClamAVWrapper {
    #clamAVSocket = null;
    #connectionError = false;
    #connectionTimeLimit = null;
    #responsesFromClamAVStream = [];
    #rejectHandler = null;
    #host = null;
    #port = null;
    /**
     * 
     * @param {string} host - ClamAV host running clamd 
     * @param {number} port - ClamAV port
     */
    constructor(host, port) {
        this.#host = host;
        this.#port = port;
        this.#connectionError = false;
    }
    #onClamAVSocketConnect() {
        this.#connectionError = false;
    }
    #onClamAVSocketConnectError(err) {
        this.#connectionError = true;
        let responseFromClamAVStream = Buffer.concat(this.#responsesFromClamAVStream);
        console.log('Unable to connect to ClamAV,', responseFromClamAVStream.toString(), err.message);
        if (this.#rejectHandler) {
            this.#destroySocket();
            this.#rejectHandler({
                success: false,
                error: true,
                message: 'Unable to connect to ClamAV, ' + responseFromClamAVStream.toString().replace('\x00', '') + ', ' + err.message
            })
        }
    }
    #streamChkTransformer() {
        return new Transform(
            {
                transform(chunk, encoding, callback) {
                    const chunkLength = Buffer.alloc(4);
                    chunkLength.writeUInt32BE(chunk.length, 0);
                    this.push(chunkLength);
                    this.push(chunk);
                    callback();
                },
                flush(callback) {
                    const flushBuff = Buffer.alloc(4);
                    flushBuff.writeUInt32BE(0, 0);
                    this.push(flushBuff);
                    callback();
                }
            })
    }
    /**
     * @typedef ScanResponse
     * @type {object}
     * @property {boolean} error
     * @property {boolean} success
     * @property {string} message
     */
    /**
     * Scan stream
     * @param {ReadableStream} stream - Readable stream to scan
     * @param {Object} [options] - Scan options
     * @param {number} [options.connectionTimeOut = 600000] - Connection timeout for socket. default 600000 
     * @returns {Promise<ScanResponse>}
     */
    scanStream(stream, options) {
        let defaultOptions = {
            connectionTimeOut: 600000 //10 minutes
        }
        options = {
            ...defaultOptions,
            ...options
        };
        this.#responsesFromClamAVStream = [];

        this.#clamAVSocket = net.createConnection({
            host: this.#host,
            port: this.#port
        }, () => { this.#onClamAVSocketConnect() }).on('error', (err) => {

            this.#onClamAVSocketConnectError(err)
        });
        this.#clamAVSocket.setKeepAlive(true);

        return new Promise((resolve, reject) => {
            this.#rejectHandler = reject;
            clearTimeout(this.#connectionTimeLimit);
            if (!this.#connectionError && this.#clamAVSocket != null) {
                this.#clamAVSocket.write('zINSTREAM\0');
                let hasCompleteStreaminFileToClamAV = false;
                let streamReadingStarted = false;
                stream.pipe(this.#streamChkTransformer()).pipe(this.#clamAVSocket);

                stream
                    .on('data', () => {
                        //clearTimeout(this.#connectionTimeLimit);
                        streamReadingStarted = true;
                    })
                    .on('end', () => {
                        hasCompleteStreaminFileToClamAV = true;
                        //stream.destroy();
                    }).on('error', (err) => {
                        this.#destroySocket();
                        reject({
                            success: false,
                            error: true,
                            message: 'Unable to read stream,' + err.message
                        })
                    });
                this.#responsesFromClamAVStream = [];
                this.#clamAVSocket.setTimeout(options.connectionTimeOut);

                this.#clamAVSocket
                    .on('data', (respChunk) => {
                        clearTimeout(this.#connectionTimeLimit);
                        if (!stream.isPaused()) {
                            stream.pause();
                        }
                        this.#responsesFromClamAVStream.push(respChunk);
                    }).on('end', () => {
                        clearTimeout(this.#connectionTimeLimit);
                        let responseFromClamAVStream = Buffer.concat(this.#responsesFromClamAVStream);
                        if (!hasCompleteStreaminFileToClamAV) {
                            this.#destroySocket();
                            reject({
                                success: false,
                                error: true,
                                message: 'Scan aborted,' + responseFromClamAVStream.toString().trim()
                            });
                        } else {
                            this.#clamAVSocket.destroy();
                            var respMessage = this.#processResponseMessage(responseFromClamAVStream.toString().trim());
                            if (respMessage.success) {
                                this.#destroySocket();
                                resolve(respMessage);
                            } else {
                                this.#destroySocket();
                                reject(respMessage);
                            }

                        }
                    });

            } else {
                this.#destroySocket();
                reject({
                    error: true,
                    success: false,
                    message: 'Unable to connect Clamd'
                })
            }

            this.#connectionTimeLimit = setTimeout(() => {
                if (this.#clamAVSocket != null) {
                    this.#destroySocket();
                    console.log('ClamAV socket destroyed...')
                }
            }, options.connectionTimeOut)

        })
    }
    #destroySocket() {
        this.#clamAVSocket.end();
        this.#clamAVSocket.destroy();
    }
    #processResponseMessage(rawMessage) {
        let message = String(rawMessage).trim();
        message = message.replace('\x00', '');
        if (message.indexOf('stream: OK') == 0) {
            return {
                success: true,
                message: message
            }
        } else {
            return {
                success: false,
                message: message
            }
        }
    }
    /**
     * Get ClamAV version
     * @returns {Promise<string>}
     */
    clamAvVersion() {
        return this.#streamCommand('zVERSION\0');
    }
    #streamCommand(commandStr) {
        let timeOut = 5000;
        return new Promise((resolve, reject) => {
            let eClient = net.createConnection({
                host: this.#host,
                port: this.#port
            }, () => {
                eClient.write(commandStr)
            });
            eClient.setTimeout(timeOut);
            let responses = [];
            eClient
                .on('data', (response) => {
                    responses.push(response)
                })
                .on('end', () => {
                    eClient.end();
                    eClient.destroy();
                    resolve(Buffer.concat(responses).toString().trim().replace('\x00', ''));
                })
                .on('error', (err) => {
                    eClient.end();
                    eClient.destroy();
                    reject('Error execuring command ' + commandStr + ' ' + err.message);
                })
        })
    }
}

module.exports = ClamAVWrapper
