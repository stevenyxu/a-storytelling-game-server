// TODO
//
// Add voting mechanism
// Add round ending mechanism
// Add way to show how many votes are in
//
var WebSocketServer = require('ws').Server;
var EventEmitter = require('events').EventEmitter;
var util = require("util");
var FULL_GAME_SIZE = 3;
var port = process.env.PORT || 8080

var clientIdIncrementer = 1;

var Game = function() {
  this.id = Game.idIncrementer++;
  this.players = [];
  this.pastRounds = [];
};
util.inherits(Game, EventEmitter);
Game.idIncrementer = 1;
Game.FULL = 'FULL';
Game.PLAYER_JOINED = 'PLAYER_JOINED';
Game.SUBMISSION_RECEIVED = 'SUBMISSION_RECEIVED';
Game.VOTES_REQUESTED = 'VOTES_REQUESTED';
Game.prototype.players = null;
Game.prototype.pastRounds = null;
Game.prototype.currentRound = null;
Game.prototype.addPlayer = function(player) {
  this.players.push(player);
  this.emit(Game.PLAYER_JOINED);
  if (this.players.length === FULL_GAME_SIZE) {
    this.startRound();
    this.emit(Game.FULL);
  }
};
Game.prototype.getNumExpectedSubmissions = function() {
  return this.players.length;
};
Game.prototype.getState = function(player) {
  return {
    currentRound : this.currentRound === null ? null : this.currentRound.getVotingState(player),
    id: this.id,
    players: this.players.map(function(player) {
               return player.getState();
             }),
    pastRounds: [{content: 'It was a dark and stormy night.'}].concat(
                    this.pastRounds.map(function(round) {
                      return this.round.getHistoryState()
                    })
                  )

  }
};
// FIXME: this feels semi-bad
Game.prototype.startRound = function() {
  this.currentRound = new Round(this.players);
};

// FIXME: weird interface, not sure about this
var Round = function(players) {
  this.remainingVoters = players.slice(0);
  this.submissions = [];
};
Round.prototype.remainingVoters = null;
Round.prototype.submissions = null;
Round.prototype.voting = false;
Round.prototype.getVotingState = function(player) {
  return {
    submissions: this.submissions.map(function(submission) {
                   var obj = {
                     content: submission.content,
                     id: submission.id
                   };
                   if (submission.player === player) {
                     obj['player'] = player.id;
                   }
                   return obj;
                 })
  };
};
Round.prototype.getHistoryState = function() {
  return {
    submissions: this.submissions.map(function(submission) {
                   return {
                     content: submission.content,
                     id: submission.id,
                     player: submission.player.id,
                     score: submission.getScore()
                   };
                 })
  };
};

var Player = function() {
  this.id = Player.idIncrementer++;
};
Player.idIncrementer = 1;
Player.prototype.name = '';
// this is a denormalized value and can be derived from the round submission scores
Player.prototype.score = 0;
Player.prototype.getState = function() {
  return {
    id: this.id,
    name: this.name,
    score: this.score
  }
};

var Submission = function() {
  this.id = Submission.idIncrementer++;
  this.votes = [];
};
Submission.idIncrementer = 1;
Submission.prototype.content = '';
Submission.prototype.player = null;
Submission.prototype.votes = null;
Submission.prototype.getScore = function() {
  return this.votes.length;
}

var AStorytellingGameServer = new WebSocketServer({port: port});
AStorytellingGameServer.pendingGame = null;
AStorytellingGameServer.on('connection', function(ws) {
  var currentPlayer;
  var currentGame;
  var clientId = clientIdIncrementer++;
  var log = function() {
    args = ['[%s] %s'];
    args.push(clientId);
    args.push(util.format.apply(util, Array.prototype.slice.call(arguments, 0)));
    console.log.apply(this, args);
  };
  log('Client connected.');
  ws.on('message', function(message) {
    try {
      var messageObj = JSON.parse(message);
    } catch(e) {
      log('Failed to parse message: %s', e);
      ws.send(JSON.stringify({
        code: 'clientError',
        message: 'I could not parse your JSON.'
      }));
      return;
    }
    switch(messageObj.code) {
      case 'identifyResponse':
        log('Received identification response as %s', messageObj.name);
        if (AStorytellingGameServer.pendingGame === null) {
          var newGame = new Game();
          console.log('Provisioned new game %d.', newGame.id);
          newGame.on(Game.FULL, function() {
            var roster = newGame.players.map(function(p) { return p.name; }).join(', ')
            console.log('Game %d is now full. Players:', newGame.id, roster);
            AStorytellingGameServer.pendingGame = null;
          });
          AStorytellingGameServer.pendingGame = newGame;
        }
        currentPlayer = new Player();
        currentPlayer.name = messageObj.name;
        currentGame = AStorytellingGameServer.pendingGame;
        ws.send(JSON.stringify({
          code: 'currentPlayerUpdate',
          player: currentPlayer.getState(currentPlayer)
        }));
        currentGame.on(Game.PLAYER_JOINED, function() {
          ws.send(JSON.stringify({
            code: 'playerJoined',
            game: currentGame.getState(currentPlayer)
          }));
        });
        currentGame.on(Game.SUBMISSION_RECEIVED, function() {
          ws.send(JSON.stringify({
            code: 'submissionReceived',
            game: currentGame.getState(currentPlayer)
          }));
        });
        currentGame.on(Game.VOTES_REQUESTED, function() {
          ws.send(JSON.stringify({
            code: 'vote',
            message: 'Please send your vote. Send something like {"code":"voteResponse","submission":5}',
            game: currentGame.getState(currentPlayer)
          }));
        });
        currentGame.on(Game.FULL, function() {
          ws.send(JSON.stringify({
            code: 'submit',
            message: 'Please submit your content. Send a response like {"code":"submitResponse","content":"Dr. Frankenstein was busy at work."}',
            game: currentGame.getState(currentPlayer)
          }));
        });
        currentGame.addPlayer(currentPlayer);
        break;
      case 'submitResponse':
        if (currentGame.currentRound.submissions.some(function(s) { return s.player === currentPlayer })) {
          log('Submission rejected from %s, since the player already submitted.', currentPlayer.name);
          ws.send(JSON.stringify({
            code: 'submitRejected',
            message: 'You have already submitted.'
          }));
        } else {
          var submission = new Submission();
          submission.player = currentPlayer;
          submission.content = messageObj.content;
          currentGame.currentRound.submissions.push(submission);
          log('Submission received by %s: %s', currentPlayer.name, submission.content);
          currentGame.emit(Game.SUBMISSION_RECEIVED);
          // FIXME: move elsewhere?
          if (currentGame.currentRound.submissions.length === currentGame.getNumExpectedSubmissions()) {
            console.log('Game %d advancing to voting round.', currentGame.id);
            currentGame.emit(Game.VOTES_REQUESTED);
          }
        }
        break;
      case 'voteResponse':
        var submissionId = messageObj.submission;
        var currentRound = currentGame.currentRound;
        if (!currentRound.voting) {
          log('Vote received from %s, but voting is not open.', currentPlayer.name);
          ws.send(JSON.stringify({
            code: 'voteRejected',
            message: 'Voting is not currently open.'
          }));
          break;
        }
        break;
      default:
        log('Unrecognized code %s', messageObj.code);
    }
  });
  ws.send(JSON.stringify({
    code: 'identify',
    message: 'Please identify yourself. Send a response like {"code":"identifyResponse","name":"Bill Clinton"}'
  }));
});

console.log('Server started on port %s.', port);
