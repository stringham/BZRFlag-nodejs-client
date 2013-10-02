module.exports = BZRClient;

var net = require('net'),
	bind = function(fn, selfObj, var_args) {
		if (!fn) {
			throw new Error();
		}
		if (arguments.length > 2) {
			var boundArgs = Array.prototype.slice.call(arguments, 2);
			return function() {
				// Prepend the bound arguments to the current arguments.
				var newArgs = Array.prototype.slice.call(arguments);
				Array.prototype.unshift.apply(newArgs, boundArgs);
				return fn.apply(selfObj, newArgs);
			};

		} else {
			return function() {
				return fn.apply(selfObj, arguments);
			};
		}
	};

function BZRClient(port, host, debug){
	this.client = net.connect({port:port,host:host||'localhost'}, function(){/*client connected*/});
	this.debug = debug;
	this.nextDataCallbacks = [];
	this.data = '';
	this.runningCommand = false;
	this.queue = [];
	this.init();
	this.handshake();
}


BZRClient.prototype.doAction = function(command, callback){
	var me = this;
	this.runCommand(function(done){
		me.sendCommand(command);
		me.readAck(function(){
			me.readBoolean(function(result){
				if(callback)
					callback(result);
				done();
			});
		});
	});
}

BZRClient.prototype.getInfo = function(command, reader, callback){
	var me = this;
	this.runCommand(function(done){
		me.sendCommand(command);
		me.readAck(function(ackResponse){
			reader(function(result){
				if(callback)
					callback(result, parseFloat(ackResponse[0]));
				done();
			});
		});
	});
}

BZRClient.prototype.nextCommand = function() {
	if(!this.runningCommand && this.queue.length > 0){
		this.queue.shift()();
	}
};

BZRClient.prototype.runCommand = function(command) {
	var me = this;
	this.queue.push(function(){
		me.runningCommand = true;
		command(function(){
			me.runningCommand = false;
			me.nextCommand();
		});
	});
	this.nextCommand();
};

BZRClient.prototype.init = function() {
	var me = this;
	this.client.on('data', function(data){
		me.data += data;
		if(me.nextDataCallbacks.length > 0){
			me.nextDataCallbacks.shift()();
		}
		if(me.debug)
			console.log('Received: ' + data);
	});
	this.client.on('end', function(){
		console.log('client disconnected');
	});
};

BZRClient.prototype.onNextData = function(f) {
	this.nextDataCallbacks.push(f);
};

BZRClient.prototype.getNextLine = function(callback){
	var me = this;
	var i = this.data.indexOf('\n');
	if(i != -1){
		var result = this.data.substring(0,i);
		this.data = this.data.substring(i+1);
		callback(result);
	} else{
		this.onNextData(function(){
			me.getNextLine(callback);
		});
	}
}

BZRClient.prototype.sendCommand = function(command) {
	this.client.write(command+'\n');
};

BZRClient.prototype.handshake = function() {
	var me = this;
	this.runCommand(function(done){
		me.expect(['bzrobots', '1'], true, function(){
			me.sendCommand('agent 1');
			done();
		});
	})
};

BZRClient.prototype.close = function() {
	this.client.end();
};

BZRClient.prototype.readArray = function(callback) {
	this.getNextLine(function(line){
		callback(line.split(/\s+/));
	});
};

BZRClient.prototype.fail = function(expected, received) {
	console.log("UNEXPECTED RESPONSE:");
	console.log("	EXPECTED: " + expected);
	console.log("  RECEIVED: " + received.join(' '));
	throw new Error();
};

BZRClient.prototype.expect = function(expected, full, callback) {
	var me = this;
	if(typeof expected == 'string')
		expected = [expected];
	this.readArray(function(line){
		var good = true;
		if(full && expected.length != line.length)
			good = false;
		else{
			for(var i=0; i<expected.length; i++){
				if(line[i] != expected[i]){
					good = false;
					break;
				}
			}
		}
		if(!good){
			me.fail(expected.join(' '), line);
		}

		if(full){
			callback(true);
			return;
		}
		callback(line.slice(expected.length));
	});
};

BZRClient.prototype.expectMultiple = function(possibilities, full, callback) {
	var me = this;
	this.readArray(function(line){
		for(var i=0; i<possibilities.length; i++){
			var possibility = possibilities[i].split(' ');
			var good = true;
			for(var j=0; j<possibility.length; j++){
				if(possibility[j] != line[j]){
					good = false;
					break;
				}
			}
			if(good && (!full || line.length == possibility.length)){
				callback(i, line.slice(possibility.length));
				return;
			}
		}
		me.fail(possibilities.map(function(p){return p.join(' ')}).join(' or '), line);
	});
};

BZRClient.prototype.readAck = function(callback){
	this.expect('ack', false, callback);
};

BZRClient.prototype.readBoolean = function(callback) {
	var response = this.expectMultiple(['ok','fail'], false, function(i, result){
		callback([true,false][i]);
	});
};

BZRClient.prototype.readTeams = function(callback) {
	var me = this;
	var teams = [];
	function getTeam(){
		me.expectMultiple(['team','end'], false, function(i, result){
			if(i==1){
				callback(teams);
				return;
			}
			var team = {
				color: result[0],
				count: parseInt(result[1],10)
			};
			teams.push(team);
			getTeam();
		});
	}
	this.expect('begin', false, function(){
		getTeam();
	});
};

BZRClient.prototype.readObstacles = function(callback) {
	var me = this;
	var obstacles = [];
	function getObstacle(){
		me.expectMultiple(['obstacle','end'], false, function(i, result){
			if(i==1){
				callback(obstacles);
				return;
			}
			var obstacle = [];
			for(var i=0; i<result.length; i+=2){
				obstacle.push({
					x:parseFloat(result[i]),
					y:parseFloat(result[i+1])
				});
			}
			obstacles.push(obstacle);
			getObstacle();
		});
	}
	this.expect('begin', false, function(){
		getObstacle();
	});
};

BZRClient.prototype.readOccgrid = function(callback) {
	var me = this;
	var grid = {grid:{}};
	this.readArray(function(line){
		if(line.indexOf('fail') != -1){
			callback(grid);
			return;
		}
		me.expect('at', false, function(pos){
			pos = pos.split(',');
			grid.pos = {x:parseFloat(pos[0]),y:parseFloat(pos[1])};
			me.expect('size', false, function(size){
				size=size.split('x');
				grid.size = {x:parseFloat(size[0]),y:parseFloat(size[1])};
				getRow(0);
			});
		});
	});

	function getRow(index){
		if(index == grid.size.x){
			callback(grid);
		}
		me.readArray(function(line){
			for(var i=0; i<line.length; i++){
				grid.grid[index+','+i] = line[i] == '1' ? 1 : 0;
			}
			getRow(index+1);
		});
	}
};

BZRClient.prototype.readFlags = function(callback) {
	var me = this;
	var flags = [];
	function getFlag(){
		me.expectMultiple(['flag','end'], false, function(i, result){
			if(i==1){
				callback(flags);
				return;
			}
			var flag = {
				color: result[0],
				possessionColor: result[1],
				loc: {
					x:parseFloat(result[2]),
					y:parseFloat(result[3])
				}
			};
			flags.push(flag);
			getFlag();
		});
	}
	this.expect('begin', false, function(){
		getFlag();
	});
};

BZRClient.prototype.readShots = function(callback) {
	var me = this;
	var shots = [];
	function getShot(){
		me.expectMultiple(['shot','end'], false, function(i, result){
			if(i==1){
				callback(shots);
				return;
			}
			var shot = {
				x:parseFloat(result[0]),
				y:parseFloat(result[1]),
				vx:parseFloat(result[2]),
				vy:parseFloat(result[3])
			};
			shots.push(shot);
			getShot();
		});
	}
	this.expect('begin', false, function(){
		getShot();
	});
};

BZRClient.prototype.readMyTanks = function(callback){
	var me = this;
	var tanks = [];
	function getTank(){
		me.expectMultiple(['mytank','end'], false, function(i, result){
			if(i==1){
				callback(tanks);
				return;
			}
			var tank = {
				index: parseInt(result[0]),
				callsign: result[1],
				status: result[2],
				shotsAvailable: parseInt(result[3]),
				timeToReload: parseFloat(result[4]),
				flag: result[5],
				loc: {
					x:parseFloat(result[6]),
					y:parseFloat(result[7])
				},
				angle:parseFloat(result[8]),
				vx:parseFloat(result[9]),
				vy:parseFloat(result[10]),
				angvel:parseFloat(result[11])
			};
			tanks.push(tank);
			getTank();
		});
	};
	this.expect('begin', false, function(){
		getTank();
	});
};

BZRClient.prototype.readOtherTanks = function(callback){
	var me = this;
	var tanks = [];
	function getTank(){
		me.expectMultiple(['othertank','end'], false, function(i, result){
			if(i==1){
				callback(tanks);
				return;
			}
			var tank = {
				callsign: result[0],
				color: result[1],
				status: result[2],
				flag: result[3],
				loc:{
					x:parseFloat(result[4]),
					y:parseFloat(result[5])
				},
				angle:parseFloat(result[6]),
			};
			tanks.push(tank);
			getTank();
		});
	};
	this.expect('begin', false, function(){
		getTank();
	});
};

BZRClient.prototype.readBases = function(callback) {
	var me = this;
	var bases = [];
	function getBase(){
		me.expectMultiple(['base','end'], false, function(i, result){
			if(i==1){
				callback(bases);
				return;
			}
			var base = {
				color: result[0],
				corners: []
			};
			for(var i=1; i<result.length; i+=2){
				base.corners.push({x:parseFloat(result[i]),y:parseFloat(result[i+1])});
			}
			bases.push(base);
			getBase();
		});
	};
	this.expect('begin', false, function(){
		getBase();
	});
};

BZRClient.prototype.readConstants = function(callback){
	var me = this;
	var constants = {};
	function getConstant(){
		me.expectMultiple(['constant','end'], false, function(i, result){
			if(i==1){
				callback(constants);
				return;
			}
			constants[result[0]] = result[1];
			getConstant();
		});
	}
	me.expect('begin', false, function(){
		getConstant();
	});
}

////////////////////////////////////////////////////////////////////////////////////////
//                              PUBLIC METHODS
////////////////////////////////////////////////////////////////////////////////////////



/////////////////////////////////////////////////////////////////////////////
//                                 ACTIONS
/////////////////////////////////////////////////////////////////////////////
BZRClient.prototype.shoot = function(id, callback) {
	this.doAction('shoot ' + id, callback);
};

BZRClient.prototype.speed = function(id, speed, callback) {
	this.doAction('speed ' + id + ' ' + speed, callback);
};

BZRClient.prototype.angvel = function(id, angvel, callback) {
	this.doAction('angvel ' + id + ' ' + angvel, callback);
};


/////////////////////////////////////////////////////////////////////////////
//                          INFORMATION REQUESTS
/////////////////////////////////////////////////////////////////////////////
BZRClient.prototype.getTeams = function(callback) {
	this.getInfo('teams', bind(this.readTeams,this), callback);
};

BZRClient.prototype.getObstacles = function(callback) {
	this.getInfo('obstacles', bind(this.readObstacles,this), callback);
};

BZRClient.prototype.getOccgrid = function(tankId, callback) {
	this.getInfo('occgrid', bind(this.readOccgrid,this), callback);
};

BZRClient.prototype.getFlags = function(callback) {
	this.getInfo('flags', bind(this.readFlags,this), callback);
};

BZRClient.prototype.getShots = function(callback) {
	this.getInfo('shots', bind(this.readShots,this), callback);
};

BZRClient.prototype.getMyTanks = function(callback) {
	this.getInfo('mytanks', bind(this.readMyTanks,this), callback);
};

BZRClient.prototype.getOtherTanks = function(callback) {
	this.getInfo('othertanks', bind(this.readOtherTanks,this), callback);
};

BZRClient.prototype.getBases = function(callback) {
	this.getInfo('bases', bind(this.readBases,this), callback);
};

BZRClient.prototype.getConstants = function(callback) {
	this.getInfo('constants', bind(this.readConstants,this), callback);
};