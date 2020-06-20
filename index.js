const http = require( 'http' );

const games = {};

function nameToId( name ) {
	var id = name.toLowerCase();
	if( id.length > 20 ) {
		id = id.substr(0, 20);
	}
	return id;
}

class WaitHandle {
	constructor() {
		const self = this;
		this._promise = new Promise( resolve => self._notify = resolve );
	}
	notify() {
		const self = this;
		const notifyFunc = this._notify;
		this._promise = new Promise( resolve => self._notify = resolve );
		notifyFunc();
	}
	async wait() {
		await this._promise;
	}
}

class Game {
	constructor( name ) {
		this.name = name;
		this.lastUpdate = new Date().getTime();
		this.version = 1;
		this._data = "";
		this._waitHandle = new WaitHandle();
	}
	getData() {
		return this._data;
	}
	updateData( newData ) {
		this.lastUpdate = new Date().getTime();
		this.version += 1;
		this._data = newData;
		this._waitHandle.notify();
	}
	async waitForChange() {
		await this._waitHandle.wait();
	}
}

function badRequest( res, message ) {
	res.writeHead(400);
	res.end( JSON.stringify( {
		error: 400,
		message: message
	} ) );
	return true;
}

function notFound( res, message ) {
	res.writeHead(404);
	res.end( JSON.stringify( {
		error: 404,
		message: message
	} ) );
	return true;
}

function writeGame( res, game ) {
	res.writeHead(200);
	res.end( JSON.stringify( {
		data: game.getData(),
		version: game.version,
		waitForChangeUrl: '/' + game.name + '/' + (game.version+1),
		updateUrl: '/' + game.name + '/' + game.version + '/update'
	} ) );
	return true;
}

const maxBodyLength = 16 * 1024;

async function readBody( req ) {
	return new Promise( ( resolve, reject ) => {
		let body = '';
		req.on('data', chunk => {
			body += chunk.toString();
			if( body.length > maxBodyLength ) {
				req.socket.destroy();
				reject( "body too large" );
			}
		} );
		req.on('close', () => {
			reject( "client disconnected" );
		} );
		req.on('end', () => {
			resolve( body );
		} );
	} );
}

async function newGameHandler( match, req, res ) {
	const name = match[1];
	const id = nameToId( name );
	const data = await readBody( req );
	if( games[id] ) {
		return badRequest( res, "game already exists" );
	}
	const game = new Game( name );
	game.updateData( data );
	games[id] = game;
	writeGame( res, game );
}

async function getGameHandler( match, req, res ) {
	const name = match[1];
	const version = parseInt( match[2] );
	const game = games[ nameToId( name ) ];
	if( !game ) {
		return notFound( res, "game does not exist" );
	}
	if( version > game.version ) {
		await game.waitForChange()
	}
	return writeGame( res, game );
}

async function updateGameHandler( match, req, res ) {
	const name = match[1];
	const id = nameToId( name );
	const data = await readBody( req );
	const version = parseInt( match[2] );
	const game = games[ id ];
	if( !game ) {
		return notFound( res, "game does not exist" );
	}
	if( game.version !== version ) {
		return badRequest( res, "specified game version does not match current game version" );
	}
	game.updateData( data );
	writeGame( res, game );
}

async function corsPreflightHandler( match, req, res ) {
	res.writeHead(200);
	res.end();
}

const handlers = [

	// new game + cors
	{ method: 'PUT',     pattern: new RegExp( "^/([a-zA-Z]{1,20})$" ), handler: newGameHandler },
	{ method: 'OPTIONS', pattern: new RegExp( "^/([a-zA-Z]{1,20})$" ), handler: corsPreflightHandler },

	// get/update/cors for game
	{ method: 'GET',      pattern: new RegExp( "^/([a-zA-Z]{1,20})/([0-9]{1,9})$" ), handler: getGameHandler },
	{ method: 'PUT',      pattern: new RegExp( "^/([a-zA-Z]{1,20})/([0-9]{1,9})$" ), handler: updateGameHandler },
	{ method: 'OPTIONS',  pattern: new RegExp( "^/([a-zA-Z]{1,20})/([0-9]{1,9})$" ), handler: corsPreflightHandler },

];

const listener = function( req, res ) {
	console.log( req.method, req.url );
	res.setHeader( 'Access-Control-Allow-Origin', '*' );
	res.setHeader( 'Access-Control-Allow-Methods', 'OPTIONS, GET, PUT' );
	for( const handler of handlers ) {
		if( handler.method !== req.method ) {
			continue;
		}
		const match = req.url.match( handler.pattern );
		if( match ) {
			handler.handler( match, req, res );
			return;
		}
	}
	notFound( res, "not found" );
}

const server = http.createServer( listener );
server.listen(8080);