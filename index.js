/**
 * A Bot for Slack!
 */


var request = require('request');
var j = request.jar();
var Q = require('q');

var loc = require('./loc.json');
var sex = [':male_sign:', ':female_sign:', ':robot_face:'];

const login_url = process.env.STATUS_LOGIN_URL;
const status_username = process.env.STATUS_LOGIN;
const status_password = process.env.STATUS_PASS;
const status_url = process.env.STATUS_URL;
const bot_token = process.env.BOT_TOKEN;
const insightsGroupID = process.env.GROUP_ID;
const comp_ids = process.env.COMP_IDS.split(',');

var stats = {};
var goodStatus = ["operational", "completed", "resolved"];
var warnStatus = ["partial_outage", "scheduled"]
var insightsComps = {};


/**
 * Define a function for initiating a conversation on installation
 * With custom integrations, we don't have a way to find out who installed us, so we can't message them :(
 */

function onInstallation(bot, installer) {
    if (installer) {
        bot.startPrivateConversation({user: installer}, function (err, convo) {
            if (err) {
                console.log(err);
            } else {
                convo.say('I am a bot that has just joined your team');
                convo.say('You must now /invite me to a channel so that I can be of use!');
            }
        });
    }
}

/**
 * Configure the persistence options
 */

var config = {};
if (process.env.MONGOLAB_URI) {
    var BotkitStorage = require('botkit-storage-mongo');
    config = {
        storage: BotkitStorage({mongoUri: process.env.MONGOLAB_URI})
    };
} else {
    config = {
        json_file_store: ((process.env.TOKEN)?'/var/lib/slackbot/db_slack_bot_ci/':'/var/lib/slackbot/db_slack_bot_a/') //use a different name if an app or CI
    };
}

/**
 * Are being run as an app or a custom integration? The initialization will differ, depending
 */
if (process.env.TOKEN || process.env.SLACK_TOKEN) {
    //Treat this as a custom integration
    var customIntegration = require('./lib/custom_integrations');
    var token = (process.env.TOKEN) ? process.env.TOKEN : process.env.SLACK_TOKEN;
    var controller = customIntegration.configure(token, config, onInstallation);
} else if (process.env.CLIENT_ID && process.env.CLIENT_SECRET && process.env.PORT) {
    //Treat this as an app
    var app = require('./lib/apps');
    var controller = app.configure(process.env.PORT, process.env.CLIENT_ID, process.env.CLIENT_SECRET, config, onInstallation);
} else {
    console.log('Error: If this is a custom integration, please specify TOKEN in the environment. If this is an app, please specify CLIENTID, CLIENTSECRET, and PORT in the environment');
    process.exit(1);
}


/**
 * A demonstration for how to handle websocket events. In this case, just log when we have and have not
 * been disconnected from the websocket. In the future, it would be super awesome to be able to specify
 * a reconnect policy, and do reconnections automatically. In the meantime, we aren't going to attempt reconnects,
 * WHICH IS A B0RKED WAY TO HANDLE BEING DISCONNECTED. So we need to fix this.
 *
 * TODO: fixed b0rked reconnect behavior
 */
// Handle events related to the websocket connection to Slack
controller.on('rtm_open', function (bot) {
    console.log('** The RTM api just connected!');
});

function start_rtm(bot) {
    bot.startRTM(function(err,bot,payload) {
        if (err) {
            console.log('Failed to start RTM');
            return setTimeout(start_rtm, 60000);
        }
        console.log("RTM started!");
    });
}

controller.on('rtm_close', function (bot) {
    console.log('** The RTM api just closed');
    // you may want to attempt to re-open
    start_rtm(bot);
});


/**
 * Core bot logic goes here!
 */
// BEGIN EDITING HERE!

// Utility functions

Object.prototype.isEmpty = function() {
    for (var prop in this) if (this.hasOwnProperty(prop)) return false;
    return true;
};

function login() {
    var deferred = Q.defer();
    if (j.getCookies(login_url).length > 0 && j.getCookies(login_url)[0].TTL() > 0) {
        deferred.resolve();
        return deferred.promise;
    }
    var options = {
        url: login_url,
        form: {
            page_access_user: {
                email: status_username,
                password: status_password
            },
        },
        jar: j,
        followAllRedirects: true
    }
    request.post(options, function (error, response, body) {
        if (error) {
            deferred.reject(new Error(error));
        } else {
            deferred.resolve();
        }
    });

    return deferred.promise;
}

function get_symbol(incStatus){
    let symbol = "";
    if (goodStatus.indexOf(incStatus) >= 0){
        symbol = "good";
    } else if (warnStatus.indexOf(incStatus) >= 0)){
        symbol = "warn";
    } else {
        symbol = "danger";
    }
    return symbol;
}

function format_components(){
    let fields = [];
    let symbol = "";
    for(var key in insightsComps) {
        component = insightsComps[key];
        if (component.status == "operational" && symbol != "warn") {
            symbol = "good";
        } else {
            if (symbol == "warn") {
                symbol = "danger";
            } else {
                symbol = "warn";
            }
        }

        fields.push({
            title: component.name + ": `" + component.status + "`",
            value: "Updated at: " + new Date(component.updated_at).toString(),
            short: false
        });
    }
    let msg = {
        "attachments": [
            {
                "fallback": "Insights Services Status",
                "color": symbol,
                "title": "Insights Services Status",
                "fields": fields,
                "footer": "Insights Statusbot",
                "footer_icon": "https://platform.slack-edge.com/img/default_application_icon.png"
            }
        ]
    }
    return msg;
}

function format_incident(incident, header) {
    let symbol = get_symbol(incident.status);

    let msg = {
        "text": header,
        "attachments": [
            {
                "color": symbol,
                "fields": [
                    {
                        title: incident.name,
                        value: "Status: `" + incident.status + "`\nCreated at: " + new Date(incident.created_at).toString() + "\nUpdated at: " + new Date(incident.updated_at).toString(),
                        short: false
                    },
                    {
                        title: "Note:",
                        value: incident.incident_updates[0].body
                    }
                ],
                "footer": "Insights Statusbot",
                "footer_icon": "https://platform.slack-edge.com/img/default_application_icon.png"
            }
        ]
    }

    return msg;
}

function formatUptime(uptime_secs) {
    var days    = Math.floor(uptime_secs / 86400);
    uptime_secs %= 86400;
    var hours   = Math.floor(uptime_secs / 3600);
    uptime_secs %= 3600;
    var minutes = Math.floor(uptime_secs / 60);
    uptime_secs %= 60
    var seconds = Math.floor(uptime_secs);

    if (hours   < 10) {hours   = "0"+hours;}
    if (minutes < 10) {minutes = "0"+minutes;}
    if (seconds < 10) {seconds = "0"+seconds;}
    return days+'d:'+hours+'h:'+minutes+'m:'+seconds+'s';
}

function get_status() {
    var deferred = Q.defer();
    
    request.get({url: status_url, jar: j, followAllRedirects: true}, function(err, response, body){
        if (err) {
            deferred.reject(new Error(err));
        } else {
            let new_stats = JSON.parse(body);
            let care = false;
            new_stats.incidents.forEach((incident) => {
                console.log("New Incident is:\n" + JSON.dumps(incident))
                if (!stats.isEmpty()) {
                    console.log("Current most recent is:\n" + JSON.dumps(stats.incidents[0]))
                }
                if (stats.isEmpty() || new Date(incident.updated_at) > new Date(stats.incidents[0].updated_at)) {
                    incident.components.forEach((comp) => {
                        if (comp_ids.includes(comp.id) || comp.group_id == insightsGroupID){
                            care = true;
                            insightsComps[comp.id] = comp;
                        }
                    });
                }
            });

            if (care) {
                stats = new_stats;
            }
            deferred.resolve(care);
        }
    });

    return deferred.promise;
}

// Available Commands
controller.hears('^update$', ['direct_mention', 'direct_message'], function(bot, message) {
    controller.trigger('update_request', [bot, message]);
});

controller.hears('pinky', ['direct_mention', 'direct_message'], function (bot, message) {
    bot.reply(message, "Narf!");
});

controller.hears('status', ['direct_mention', 'direct_message'], function (bot, message) {
    controller.trigger('status_request', [bot, message]);
});

controller.hears(['components', '^comps$'], ['direct_mention','direct_message'], function(bot, message) {
    controller.trigger('component_request', [bot, message]);
});

controller.hears(['last', 'last_incident'], ['direct_mention', 'direct_message'], function(bot, message) {
    controller.trigger('last_request', [bot, message]);
});

controller.hears(['uptime', 'identify yourself', 'who are you', 'what is your name'], 
    ['direct_message', 'direct_mention,mention'], function(bot, message) {
        controller.trigger('uptime_request', [bot, message]);
});

controller.hears('a/s/l', 'direct_mention', function(bot, message) {
    controller.trigger('90s_request', [bot, message]);
});

controller.hears(['^help$', '^commands$'], ['direct_mention', 'direct_message'], function(bot, message){
    let msg = "*Available commands:*\n• status: Reports overall Insights service status\n" +
              "• components or comps: Show the status of each individual Insights component\n" +
              "• last: Show the most recent incident's status\n" +
              "• uptime: Show host and uptime data for the bot.";
    bot.reply(message, msg);

});

// Functionality

setInterval(function(){
    let bot = controller.spawn({});
    controller.trigger('update_request', [bot, {}]);
}, 60000);

controller.on('update_request', function(bot, message) {
    login()
    .then(get_status)
    .then(function(care){
        if(care){
            let msg = format_incident(stats.incidents[0], "Insights Maintenance Incident Update");
            msg.channel = process.env.ALERT_CHANNEL;
            msg.token = bot_token;
            bot.api.chat.postMessage(msg);
        }
    })
    .catch(function (error) {
        console.log("Error Updating status: ", err);
    })

});

controller.on('status_request', function(bot, message) {
    login()
    .then(get_status)
    .then(function() {
        if (!stats.isEmpty()) {
            bot.reply(message, stats.status.description);
        } else {
            bot.reply(message, "Status not currently available.");
        }
    })
    .catch(function(err) {console.log(err)});
});

controller.on('component_request', function(bot, message) {
    login()
    .then(get_status)
    .then(function() {
        if(!stats.isEmpty()) {
            let msg = format_components();
            bot.reply(message, msg);
        } else {
            bot.reply(message, "Components not currently available.");
        }
    })
    .catch(function(err) {console.log(err)})
});

controller.on('last_request', function(bot, message) {
    login()
    .then(get_status)
    .then(function() {
        if (!stats.isEmpty()) {
            let msg = format_incident(stats.incidents[0], "Most recent Insights Incident");
            bot.reply(message, msg);
        } else {
            bot.reply(message, "Incidents not currently available.");
        }
    })
    .catch(function(err) {console.log(err)})
});

controller.on('uptime_request', function(bot, message) {
    var hostname = process.env.HOSTNAME;
    var uptime = formatUptime(process.uptime());

    bot.reply(message, ':robot_face: I am a bot named <@' + bot.identity.name +
              '>. I have been running for ' + uptime + ' on ' + hostname + '.');
});

controller.on('90s_request', function(bot, message) {
    let age = Math.floor(Math.random() * (205 - 16)) + 16;
    let myloc = loc[Math.floor(Math.random() * loc.length)];
    let mysex = sex[Math.floor(Math.random() * sex.length)];
    bot.reply(message, age + "/" + mysex + "/" + myloc);
});
