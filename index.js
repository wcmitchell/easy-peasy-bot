/**
 * A Bot for Slack!
 */


var request = require('request');
var j = request.jar();
var loc = require('./loc.json');
var sex = [':male_sign:',':female_sign:',':robot_face:'];

const login_url = process.env.STATUS_LOGIN_URL;
const status_url = process.env.STATUS_URL;

var stats = {};

var insightsComps = {
    rpfhspmh2fx2: {
        name: "etcd service",
        status:"operational",
        created_at:"2017-05-29T12:52:20.199Z",
        updated_at:"1970-01-01T00:00:00Z"
    },
    flj89b72jyc4: {
        name:"Application Creation Service",
        status:"operational",
        created_at:"2017-05-29T12:52:20.849Z",
        updated_at:"1970-01-01T00:00:00Z"
    },
    cy1dzkkv9xgq: {
        status:"operational",
        name:"Master API Service",
        created_at:"2017-05-29T12:52:21.627Z",
        updated_at:"1970-01-01T00:00:00Z"
    },
    k18sv76c2ptj: {
        status:"operational",
        name:"Docker Registry Service",
        created_at:"2017-05-29T12:52:22.432Z",
        updated_at:"1970-01-01T00:00:00Z"
    }

};

function login(username, password, url, callback) {
    var options = {
        url: url,
        form: {
            page_access_user: {
                email: username,
                password: password
            },
        },
        jar: j,
        followAllRedirects: true
    }
    request.post(options, function (error, response, body) {
        callback(error, body);
    });

}

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
        storage: BotkitStorage({mongoUri: process.env.MONGOLAB_URI}),
    };
} else {
    config = {
        json_file_store: ((process.env.TOKEN)?'/var/lib/slackbot/db_slack_bot_ci/':'/var/lib/slackbot/db_slack_bot_a/'), //use a different name if an app or CI
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

controller.on('rtm_close', function (bot) {
    console.log('** The RTM api just closed');
    // you may want to attempt to re-open
});


/**
 * Core bot logic goes here!
 */
// BEGIN EDITING HERE!

// Utility functions

function get_symbol(incStatus){
    let symbol = "";
    if (incStatus == "operational" || incStatus == "resolved"){
        symbol = "good";
    } else if (incStatus == "partial_outage"){
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
                "footer": "Insights Statsbot",
                "footer_icon": "https://platform.slack-edge.com/img/default_application_icon.png"
            }
        ]
    }
    return msg;
}

function format_incident(incident, header) {
    let symbol = get_symbol(incident.status);

    let msg = {
        "attachments": [
            {
                "fallback": header,
                "color": symbol,
                "title": header,
                "fields": [
                    {
                        title: incident.name,
                        value: "Status: `" + incident.status + "`\nCreated at: " + new Date(incident.created_at).toString() + "\nUpdated at: " + new Date(incident.updated_at).toString(),
                        short: false
                    }
                ],
                "footer": "Insights Statsbot",
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

// Available Commands
controller.hears('^update$', ['direct_mention', 'direct_message'], function(bot, message) {
    bot.trigger('update_request', [bot, message]);
});

controller.hears('pinky', ['direct_mention', 'direct_message'], function (bot, message) {
    bot.reply(message, "Narf!");
});

controller.hears('status', ['direct_mention', 'direct_message'], function (bot, message) {
    bot.trigger('status_request', [bot, message]);
});

controller.hears(['components', '^comps$'], ['direct_mention','direct_message'], function(bot, message) {
    bot.trigger('component_request', [bot, message]);
});

controller.hears(['last', 'last_incident'], ['direct_mention', 'direct_message'], function(bot, message) {
    bot.trigger('last_request', [bot, message]);
});

controller.hears(['uptime', 'identify yourself', 'who are you', 'what is your name'], 
    ['direct_message', 'direct_mention,mention'], function(bot, message) {
        bot.trigger('uptime_request', [bot, message]);
});

controller.hears('a/s/l', 'direct_mention', function(bot, message) {
    bot.trigger('90s_request', [bot, message]);
});

controller.hears(['^help$', '^commands$'], ['direct_mention', 'direct_message'], function(bot, message){
    let msg = "*Available commands:*\n• status: Reports overall Insights service status\n" +
              "• components or comps: Show the status of each individual Insights component\n" +
              "• last: Show the most recent incident's status\n" +
              "• uptime: Show host and uptime data for the bot.";
    bot.reply(message, msg);

});

// Functionality
function get_status(callback) {
    if (!j.getCookies(login_url).length || j.getCookies(login_url)[0].TTL() < 1) {
        login(process.env.STATUS_LOGIN, process.env.STATUS_PASS, login_url, function(err, response){
            if (err) {
                console.log("Error logging in: "+err);
            } else {
                request.get({url: status_url, jar: j, followAllRedirects: true}, function(err, response, body){
                    callback(err, response, body);
                });
            }
        });
    } else {
         request.get({url: status_url, jar: j, followAllRedirects: true}, function(err, response, body){
            callback(err, response, body);
         });
    }
}

setInterval(function(){bot.trigger('update_request', [bot, {}])}, 60000);
    
controller.on('update_request', function(bot, message) {
    get_status( function(err, response, body){
    if (err) {
        console.log("Error getting stats: ", err);
    } else {
        let new_stats = JSON.parse(body);

        if (Object.keys(stats).length != 0){
            new_stats.incidents.forEach((incident) => {
                if (new Date(incident.updated_at) > new Date(stats.incidents[0].updated_data)) {
                    let symbol = "";
                    if (incident.status == "operational" || incident.status == "resolved") {
                        symbol = "good";
                    } else if (incident.status == "partial_outage") {
                        symbol = "warn";
                    } else {
                        symbol = "danger";
                    }
                    let msg = format_incident(incident, "New Insights Maintenance Incident.");
                    msg.channel = process.env.ALERT_CHANNEL;
                    bot.api.chat.postMessage(msg);
                }
                incident.components.forEach((comp) => {
                    if (comp.id in insightsComps && (new Date(insightsComps[comp.id].updated_at) < new Date(comp.updated_at))) {
                        insightsComps[comp.id] = comp;
                    }
                });
            });
        }
        stats = new_stats;
    }
});

controller.on('status_request', function(bot, message) {
    if (!Object.keys(stats).length){
        get_status(function(err, response, body){
            if (err) {
                console.log("Error getting status: "+err);
            } else {
                stats = JSON.parse(body);
                stats.incidents.forEach((incident) => {
                    incident.components.forEach((comp) => {
                        if (comp.id in insightsComps && (new Date(insightsComps[comp.id].updated_at) < new Date(comp.updated_at))) {
                            insightsComps[comp.id] = comp;
                        }
                    });
                });
                bot.reply(message, stats.status.description);
            }
        });
    } else {
        bot.reply(message, stats.status.description);
    }
});

controller.on('component_request', function(bot, message) {
    if (!Object.keys(stats).length){
        get_status(function(err, response, body){
            if (err) {
                console.log("Error getting status: "+err);
            } else {
                stats = JSON.parse(body);
                stats.incidents.forEach((incident) => {
                    incident.components.forEach((comp) => {
                        if (comp.id in insightsComps && (new Date(insightsComps[comp.id].updated_at) < new Date(comp.updated_at))) {
                            insightsComps[comp.id] = comp;
                        }
                    });
                });
                let msg = format_components();
                bot.reply(message, msg);
            }
        });
    } else {
        let msg = format_components();
        bot.reply(message, msg);
    }
});

controller.on('last_request', function(bot, message) {
    var symbol = ""
    if (!Object.keys(stats).length){
        get_status(function(err, response, body){
            if (err) {
                console.log("Error getting status: "+err);
            } else {
                stats = JSON.parse(body);
                let incident = stats.incidents[0];
                let msg = format_incident(incident, "Most recent Insights Incident");
                bot.reply(message, msg);
            }
        });
    } else {
        let incident = stats.incidents[0];
        let msg = format_incident(incident, "Most recent Insights Incident");
        bot.reply(message, msg);
    }
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
    let mysex = sex[Math.floor(Math.random() * loc.length)];
    bot.reply(message, age + "/" + mysex + "/" + myloc);
});
