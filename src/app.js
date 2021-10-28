const http = require("http");
const Readable = require('stream').Readable;
const ClamAVWrapper = require('./clamAvWrapper');

const clamHost = process.env.CLAM_HOST || '127.0.0.1';
const clamPort = process.env.CLAM_PORT || 3310;

const port = process.env.PORT || 8080;

/**
 * 
 * @param {Readable} req 
 * @param {Response} res 
 */
const requestListener = (req, res) => {
    const url = String(req.url).toLowerCase();
    let liveTimer = null;
    let clamAvInstance = new ClamAVWrapper(clamHost, clamPort);
    res.writeHead(200);
    if (url == '/scan' && String(req.method).toLowerCase() == 'post') {
        liveTimer = setTimeout(()=>{
            res.write('\n');
        },5000)
        clamAvInstance.scanStream(req).then((resp)=>{
            clearTimeout(liveTimer)
            res.write(JSON.stringify(resp));
            res.end();
        },(err)=>{
            clearTimeout(liveTimer)
            res.write(JSON.stringify(err));
            res.end();
        });
    } else {
        clamAvInstance.clamAvVersion().then((resp) => {
            res.end(resp);
        }, (err) => {
            res.end(err);
        })
    }

}

const server = http.createServer(requestListener);

server.listen(port, () => {
    console.log(`Server is running on port ${port}`);
})
