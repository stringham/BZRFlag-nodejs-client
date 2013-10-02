var BZRClient = require('./client.js');


/**
 * Note: This is just a sample team where all of the tanks on a team
 * are controlled with simple directions
 * 1. if there is an enemy flag that is not picked up, go get it.
 * 2. if you have a flag go back to your base
 * 3. otherwise go attack the closest enemy
 *
 * It should be a good starting point to see how the client is used.
 *
 * To use it just run:
 *    node agent.js <port>
 */

function Team(client){
	this.client = client;
	this.myTanks = {};
	this.init();
}

Team.prototype.init = function() {
	var me = this;
	this.client.getConstants(function(constants){
		me.constants = constants;
	});
	this.client.getBases(function(bases){
		me.bases = bases;
	});
	this.client.getMyTanks(function(myTanks, time){
		myTanks.forEach(function(tank){
			me.myTanks[tank.index] = tank;
			me.lastUpdated = time;
		});
	});
};

Team.prototype.update = function(done) {
	var me = this;
	var client = this.client;
	var callsToMake = 4;
	function received(){
		callsToMake--;
		if(callsToMake == 0)
			done();
	}
	client.getMyTanks(function(myTanks, time){
		var dt = time-me.lastUpdated;
		myTanks.forEach(function(tank){
			var dvx = (tank.vx - me.myTanks[tank.index].vx)/dt;
			var dvy = (tank.vy - me.myTanks[tank.index].vy)/dt;
			var dangvel = (tank.angvel - me.myTanks[tank.index].angvel)/dt;
			me.myTanks[tank.index] = tank;
			me.myTanks[tank.index].dvx = dvx;
			me.myTanks[tank.index].dvy = dvy;
			me.myTanks[tank.index].dangvel = dangvel;
		});

		me.lastUpdated = time;
		received();
	});
	client.getOtherTanks(function(otherTanks){
		me.otherTanks = otherTanks;
		me.enemies = otherTanks.filter(function(tank){
			return tank.color != me.constants.team;
		});
		received();
	});
	client.getFlags(function(flags){
		me.flags = flags;
		received();
	});
	client.getShots(function(shots){
		me.shots = shots;
		received();
	});
};

Team.prototype.tick = function() {
	var me = this;
	var actions = 0;
	this.update(function(){
		for(id in me.myTanks){
			var tank = me.myTanks[id];
			actions++;
			if(tank.flag != '-'){ //this tank has a flag
				var base;
				me.bases.forEach(function(b){
					if(b.color == me.constants.team){
						base = b;
					}
				});
				//go back to the base
				me.moveToPosition(tank, {x:base.corners[0].x-20,y:base.corners[0].y-20},done);
			} else {
				//this tank does not have a flag
				var min = Number.MAX_VALUE;
				var closestFlag = null;
				me.flags.forEach(function(flag){
					if(flag.possessionColor == 'none' && flag.color != me.constants.team){
						var dist = Math.sqrt(Math.pow(flag.loc.x-tank.loc.x,2)+Math.pow(flag.loc.y-tank.loc.y,2));
						if(dist < min){
							min = dist;
							closestFlag = flag;
						}
					}
				});
				if(closestFlag){ //there is an available flag
					me.moveToPosition(tank, closestFlag.loc,done);
				}else{ //no unclaimed flags. just attack the closest enemy.
					me.attack(tank, function(){
						done();
					});
				}
			}
		}
	});
	function done(){
		actions--;
		if(actions == 0)
			me.tick();
	}
};

Team.prototype.attack = function(tank, callback){
	var bestEnemy = null;
	var bestDistance = 2*parseFloat(this.constants.worldsize);
	this.enemies.forEach(function(enemy){
		if(enemy.status != 'alive')
			return;
		var dist = Math.sqrt(Math.pow((enemy.loc.x-tank.loc.x),2) + Math.pow((enemy.loc.y-tank.loc.y),2));
		if(dist < bestDistance){
			bestDistance = dist;
			bestEnemy = enemy;
		}
	});
	if(bestEnemy){
		this.moveToPosition(tank, bestEnemy.loc, callback);
	}else{
		this.client.speed(tank.index, 0);
		this.client.angvel(tank.index, 0, callback);
	}
}

Team.prototype.moveToPosition = function(tank, pos, callback) {
	var angle = Math.atan2(pos.y-tank.loc.y,pos.x-tank.loc.x);
	var relativeAngle = Math.atan2(Math.sin(angle - tank.angle), Math.cos(angle - tank.angle));
	var client = this.client;
	var distance = Math.sqrt(Math.pow(pos.x-tank.loc.x,2)+Math.pow(pos.y-tank.loc.y,2));
	client.speed(tank.index, Math.min(distance/60,1));
	client.angvel(tank.index, relativeAngle/2, callback);
	client.shoot(tank.index);
};

if(process.argv.length > 2){
	var port = process.argv[2];
	var team = new Team(new BZRClient(port));
	team.tick();
}