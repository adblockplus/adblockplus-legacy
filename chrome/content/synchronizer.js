/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is Adblock Plus.
 *
 * The Initial Developer of the Original Code is
 * Wladimir Palant.
 * Portions created by the Initial Developer are Copyright (C) 2006-2008
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *
 * ***** END LICENSE BLOCK ***** */

/*
 * Manages synchronization of filter subscriptions.
 * This file is included from nsAdblockPlus.js.
 */

var synchronizer = {
  executing: new HashTable(),
  listeners: [],
  timer: null,

  init: function() {
    this.timer = createTimer(this.synchronizeCallback, 300000);
    this.timer.type = this.timer.TYPE_REPEATING_SLACK;
  },

  synchronizeCallback: function() {
    synchronizer.timer.delay = 3600000;

    var time = new Date().getTime()/1000;
    for (var i = 0; i < prefs.subscriptions.length; i++) {
      var subscription = prefs.subscriptions[i];
      if (subscription.special || !subscription.autoDownload || subscription.external)
        continue;
  
      if (subscription.expires > time)
        continue;

      // Get the number of hours since last download
      var interval = (time - subscription.lastDownload) / 3600;
      if (interval > prefs.synchronizationinterval)
        synchronizer.execute(subscription);
    }
  },

  // Adds a new handler to be notified whenever synchronization status changes
  addListener: function(handler) {
    this.listeners.push(handler);
  },
  
  // Removes a handler
  removeListener: function(handler) {
    for (var i = 0; i < this.listeners.length; i++)
      if (this.listeners[i] == handler)
        this.listeners.splice(i--, 1);
  },

  // Calls all listeners
  notifyListeners: function(subscription, status) {
    for (var i = 0; i < this.listeners.length; i++)
      this.listeners[i](subscription, status);
  },

  isExecuting: function(url) {
    return url in this.executing;
  },

  readPatterns: function(subscription, text) {
    var lines = text.split(/[\r\n]+/);
    for (var i = 0; i < lines.length; i++) {
      lines[i] = normalizeFilter(lines[i]);
      if (!lines[i])
        lines.splice(i--, 1);
    }
    if (!/\[Adblock(?:\s*Plus\s*([\d\.]+)?)?\]/i.test(lines[0])) {
      this.setError(subscription, "synchronize_invalid_data");
      return false;
    }

    delete subscription.requiredVersion;
    delete subscription.upgradeRequired;

    var minVersion = RegExp.$1;
    if (minVersion) {
      subscription.requiredVersion = minVersion;
      if (abp.versionComparator.compare(minVersion, abp.getInstalledVersion()) > 0)
        subscription.upgradeRequired = true;
    }

    subscription.patterns = [];
    for (var i = 1; i < lines.length; i++) {
      var pattern = prefs.patternFromText(lines[i]);
      if (pattern)
        subscription.patterns.push(pattern);
    }
    prefs.initMatching();

    return true;
  },

  setError: function(subscription, error) {
    delete this.executing[subscription.url];
    subscription.lastDownload = parseInt(new Date().getTime() / 1000);
    subscription.downloadStatus = error;
    subscription.errors++;
    prefs.savePatterns();
    this.notifyListeners(subscription, "error");

    if (subscription.errors >= prefs.subscriptions_fallbackerrors && /^https?:\/\//i.test(subscription.url)) {
      var request = Components.classes["@mozilla.org/xmlextras/xmlhttprequest;1"]
                              .createInstance(Components.interfaces.nsIJSXMLHttpRequest);
      request.open("GET", prefs.subscriptions_fallbackurl.replace(/%s/g, escape(subscription.url)));
      request.channel.loadFlags = request.channel.loadFlags |
                                  request.channel.VALIDATE_ALWAYS;
      request.onload = function(ev) {
        if (subscription.errors >= prefs.subscriptions_fallbackerrors) {
          subscription.errors = 0;
          if (/^301\s+(\S+)/.test(ev.target.responseText))
            subscription.nextURL = RegExp.$1;
          prefs.savePatterns();
        }
      }
      request.send(null);
      request = null;
    }
  },

  executeInternal: function(subscription, forceDownload) {
    var url = subscription.url;
    if (url in this.executing)
      return;

    var curVersion = abp.getInstalledVersion();
    var loadFrom = (subscription.nextURL ? subscription.nextURL : url).replace(/%VERSION%/, curVersion ? "ABP" + curVersion : "");

    try {
      var request = Components.classes["@mozilla.org/xmlextras/xmlhttprequest;1"]
                              .createInstance(Components.interfaces.nsIJSXMLHttpRequest);
      request.open("GET", loadFrom);
      request.channel.loadFlags = request.channel.loadFlags |
                                  request.channel.INHIBIT_CACHING |
                                  request.channel.LOAD_BYPASS_CACHE;
    }
    catch (e) {
      this.setError(subscription, "synchronize_invalid_url");
      return;
    }

    var newURL = subscription.nextURL;
    subscription.nextURL = null;
    try {
      var oldNotifications = request.channel.notificationCallbacks;
      var oldEventSink = null;
      request.channel.notificationCallbacks = {
        QueryInterface: function(iid) {
          if (iid.equals(Components.interfaces.nsISupports) ||
              iid.equals(Components.interfaces.nsIChannelEventSink))
            return this;
      
          throw Components.results.NS_ERROR_NO_INTERFACE;
        },

        getInterface: function(iid) {
          if (iid.equals(Components.interfaces.nsIChannelEventSink)) {
            try {
              oldEventSink = oldNotifications.QueryInterface(iid);
            } catch(e) {}
            return this;
          }
    
          return (oldNotifications ? oldNotifications.QueryInterface(iid) : null);
        },

        onChannelRedirect: function(oldChannel, newChannel, flags) {
          if (flags & Components.interfaces.nsIChannelEventSink.REDIRECT_TEMPORARY)
            newURL = "";
          else if (newURL != "")
            newURL = newChannel.URI.spec;

          if (oldEventSink)
            oldEventSink.onChannelRedirect(oldChannel, newChannel, flags);
        }
      }
    } catch (e) {}

    if (subscription.lastModified && !forceDownload)
      request.setRequestHeader("If-Modified-Since", subscription.lastModified);

    request.onerror = function(ev) {
      var request = ev.target;
      try {
        request.channel.notificationCallbacks = null;
      } catch (e) {}

      if (!(url in prefs.knownSubscriptions))
        return;

      synchronizer.setError(prefs.knownSubscriptions[url], "synchronize_connection_error");
    };

    request.onload = function(ev) {
      var request = ev.target;
      try {
        request.channel.notificationCallbacks = null;
      } catch (e) {}

      delete synchronizer.executing[url];
      if (url in prefs.knownSubscriptions) {
        var subscription = prefs.knownSubscriptions[url];

        if (request.status != 304) {
          if (!synchronizer.readPatterns(subscription, request.responseText))
            return;

          subscription.lastModified = request.getResponseHeader("Last-Modified");
        }

        subscription.lastDownload = parseInt(new Date().getTime() / 1000);
        subscription.downloadStatus = "synchronize_ok";
        subscription.errors = 0;

        var expires = parseInt(new Date(request.getResponseHeader("Expires")).getTime() / 1000) || 0;
        for (var i = 0; i < subscription.patterns.length; i++) {
          if (subscription.patterns[i].type == "comment" && /\bExpires\s*(?::|after)\s*(\d+)\s*(h)?/i.test(subscription.patterns[i].text)) {
            var hours = parseInt(RegExp.$1);
            if (!RegExp.$2)
              hours *= 24;
            if (hours > 0) {
              var time = subscription.lastDownload + hours * 3600;
              if (time > expires)
                expires = time;
            }
          }
          if (subscription.patterns[i].type == "comment" && /\bRedirect(?:\s*:\s*|\s+to\s+|\s+)(\S+)/i.test(subscription.patterns[i].text))
            subscription.nextURL = RegExp.$1;
        }
        subscription.expires = (expires > subscription.lastDownload ? expires : 0);

        // Expiration date shouldn't be more than two weeks in the future
        if (subscription.expires - subscription.lastDownload > 14*24*3600)
          subscription.expires = subscription.lastDownload + 14*24*3600;

        if (newURL) {
          synchronizer.notifyListeners(subscription, "remove");
          var inlist = false;
          for (i = 0; i < prefs.subscriptions.length; i++) {
            if (prefs.subscriptions[i].url == url) {
              prefs.subscriptions.splice(i--, 1);
              inlist = true;
            }
          }

          delete prefs.knownSubscriptions[url];
          delete prefs.listedSubscriptions[url];

          url = newURL;
          subscription.url = url;

          var found = false;
          for (i = 0; i < prefs.subscriptions.length; i++) {
            if (prefs.subscriptions[i].url == url) {
              prefs.subscriptions[i] = subscription;
              found = true;
            }
          }
          if (!found && inlist)
            prefs.subscriptions.push(subscription);

          prefs.knownSubscriptions[url] = subscription;
          if (found || inlist)
            prefs.listedSubscriptions[url] = subscription;

          synchronizer.notifyListeners(subscription, "replace");
        }
        else
          synchronizer.notifyListeners(subscription, "ok");

        prefs.savePatterns();

      }
    };

    this.executing[url] = request;
    this.notifyListeners(subscription, "executing");

    try {
      request.send(null);
    }
    catch (e) {
      this.setError(subscription, "synchronize_connection_error");
    }

    // prevent cyclic references through closures
    request = null;
  },

  execute: function(subscription, forceDownload) {
    // Execute delayed so XMLHttpRequest isn't attached to the
    // load group of the calling window
    var me = this;
    if (typeof forceDownload == "undefined")
      forceDownload = false;
    createTimer(function() {me.executeInternal(subscription, forceDownload)}, 0);
  }
};

synchronizer.init();
abp.synchronizer = synchronizer;
