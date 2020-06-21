const http = require( 'http' );

const games = {};

function nameToId( name ) {
	var id = name.toLowerCase();
	if( id.length > 20 ) {
		id = id.substr(0, 20);
	}
	return id;
}

function getGame( name ) {
	const id = nameToId( name );
	return games[ id ];
}

function removeGame( name ) {
	const id = nameToId( name );
	delete games[id];
}

function addGame( name, game ) {
	const id = nameToId( name );
	games[ id ] = game;
}

class WaitHandle {
	constructor(timeoutMs) {
		const self = this;
		this._timeoutMs = timeoutMs;
		this._promise = new Promise( resolve => self._notify = resolve );
	}
	notify() {
		const self = this;
		const notifyFunc = this._notify;
		if( this._promise._timeoutHandle ) {
			clearTimeout( this._promise._timeoutHandle );
		}
		this._promise = new Promise( resolve => self._notify = resolve );
		notifyFunc();
	}
	async wait() {
		if( !this._promise._timeoutHandle ) {
			const self = this;
			const promise = this._promise;
			promise._timeoutHandle = setTimeout( () => {
				promise._timeoutHandle = false;
				self.notify();
			}, this._timeoutMs );
		}
		await this._promise;
	}
}

class Game {
	constructor( name ) {
		this.name = name;
		this.lastUpdate = new Date().getTime();
		this.version = 1;
		this._data = "";
		this._waitHandle = new WaitHandle(30000);
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
		updateUrl: '/' + game.name + '/' + (game.version+1)
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
	const data = await readBody( req );
	if( getGame( name ) ) {
		return badRequest( res, "game already exists" );
	}
	const game = new Game( name );
	game.updateData( data );
	addGame( name, game );
	writeGame( res, game );
}

async function getGameHandler( match, req, res ) {
	const name = match[1];
	const version = parseInt( match[2] );
	const game = getGame( name );
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
	const data = await readBody( req );
	const version = parseInt( match[2] );
	const game = getGame( name );
	if( !game ) {
		return notFound( res, "game does not exist" );
	}
	if( ( game.version + 1 ) !== version ) {
		return badRequest( res, "specified game version does come immediately after current game version" );
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

const listener = async function( req, res ) {
	console.log( req.method, req.url );
	res.setHeader( 'Access-Control-Allow-Origin', '*' );
	res.setHeader( 'Access-Control-Allow-Methods', 'OPTIONS, GET, PUT' );
	for( const handler of handlers ) {
		if( handler.method !== req.method ) {
			continue;
		}
		const match = req.url.match( handler.pattern );
		if( match ) {
			try {
				await handler.handler( match, req, res );
			} catch( err ) {
				console.log( err );
			}
			return;
		}
	}
	notFound( res, "not found" );
}

const server = http.createServer( listener );
server.listen(8080);