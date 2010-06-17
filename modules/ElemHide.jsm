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
 * Portions created by the Initial Developer are Copyright (C) 2006-2010
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *
 * ***** END LICENSE BLOCK ***** */

/**
 * @fileOverview Element hiding implementation.
 */

var EXPORTED_SYMBOLS = ["ElemHide"];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

let baseURL = Cc["@adblockplus.org/abp/private;1"].getService(Ci.nsIURI);

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import(baseURL.spec + "Utils.jsm");
Cu.import(baseURL.spec + "Prefs.jsm");
Cu.import(baseURL.spec + "ContentPolicy.jsm");
Cu.import(baseURL.spec + "TimeLine.jsm");

/**
 * List of known filters
 * @type Array of ElemHideFilter
 */
let filters = [];

/**
 * Lookup table, has keys for all filters already added
 * @type Object
 */
let knownFilters = {__proto__: null};

/**
 * Lookup table for filters by their associated key
 * @type Object
 */
let keys = {__proto__: null};

/**
 * Currently applied stylesheet URL
 * @type nsIURI
 */
let styleURL = null;

/**
 * Element hiding component
 * @class
 */
var ElemHide =
{
  /**
   * Indicates whether filters have been added or removed since the last apply() call.
   * @type Boolean
   */
  isDirty: false,

  /**
   * Called on module startup.
   */
  startup: function()
  {
    TimeLine.enter("Entered ElemHide.startup()");
    Prefs.addListener(ElemHide.apply);
  
    TimeLine.log("done adding prefs listener");
  
    TimeLine.log("registering component");
    let registrar = Components.manager.QueryInterface(Ci.nsIComponentRegistrar);
    registrar.registerFactory(ElemHidePrivate.classID, ElemHidePrivate.classDescription,
        "@mozilla.org/network/protocol;1?name=" + ElemHidePrivate.scheme, ElemHidePrivate);
    Policy.whitelistSchemes[ElemHidePrivate.scheme] = true;
    TimeLine.leave("ElemHide.startup() done");
  },

  /**
   * Called on module shutdown.
   */
  shutdown: function(/**Boolean*/ cleanup)
  {
    if (cleanup)
    {
      TimeLine.enter("Entered ElemHide.shutdown()");

      Prefs.removeListener(ElemHide.apply);

      let registrar = Components.manager.QueryInterface(Ci.nsIComponentRegistrar);
      registrar.unregisterFactory(ElemHidePrivate.classID, ElemHidePrivate);

      delete Policy.whitelistSchemes[ElemHidePrivate.scheme];

      ElemHide.clear();

      TimeLine.leave("ElemHide.shutdown() done");
    }
  },

  /**
   * Removes all known filters
   */
  clear: function()
  {
    filters = [];
    knownFilters= {__proto__: null};
    keys = {__proto__: null};
    ElemHide.isDirty = false;
    ElemHide.unapply();
  },

  /**
   * Add a new element hiding filter
   * @param {ElemHideFilter} filter
   */
  add: function(filter)
  {
    if (filter.text in knownFilters)
      return;

    filters.push(filter);

    do {
      filter.key = Math.random().toFixed(15).substr(5);
    } while (filter.key in keys);

    keys[filter.key] = filter;
    knownFilters[filter.text] = true;
    ElemHide.isDirty = true;
  },

  /**
   * Removes an element hiding filter
   * @param {ElemHideFilter} filter
   */
  remove: function(filter)
  {
    if (!(filter.text in knownFilters))
      return;

    let index = filters.indexOf(filter);
    if (index >= 0)
      filters.splice(index, 1);

    delete keys[filter.key];
    delete knownFilters[filter.text];
    ElemHide.isDirty = true;
  },

  /**
   * Generates stylesheet URL and applies it globally
   */
  apply: function()
  {
    // Return immediately if nothing to do
    if (!styleURL && (!Prefs.enabled || !filters.length))
      return;

    TimeLine.enter("Entered ElemHide.apply()");
    ElemHide.unapply();
    TimeLine.log("ElemHide.unapply() finished");

    ElemHide.isDirty = false;

    if (!Prefs.enabled)
    {
      TimeLine.leave("ElemHide.apply() done (disabled)");
      return;
    }

    // Grouping selectors by domains
    TimeLine.log("start grouping selectors");
    let domains = {__proto__: null};
    for each (var filter in filters)
    {
      let domain = filter.selectorDomain || "";

      let list;
      if (domain in domains)
        list = domains[domain];
      else
      {
        list = {__proto__: null};
        domains[domain] = list;
      }
      list[filter.selector] = filter.key;
    }
    TimeLine.log("done grouping selectors");

    // Joining domains list
    TimeLine.log("start building CSS data");
    let cssData = "";
    let cssTemplate = "-moz-binding: url(" + ElemHidePrivate.scheme + ":%ID%#dummy) !important;";

    for (let domain in domains)
    {
      let rules = [];
      let list = domains[domain];
      for (let selector in list)
        rules.push(selector + "{" + cssTemplate.replace("%ID%", list[selector]) + "}\n");

      if (domain)
        cssData += '@-moz-document domain("' + domain.split(",").join('"),domain("') + '"){\n' + rules.join('') + '}\n';
      else {
        // Only allow unqualified rules on a few protocols to prevent them from blocking chrome
        cssData += '@-moz-document url-prefix("http://"),url-prefix("https://"),'
                  + 'url-prefix("mailbox://"),url-prefix("imap://"),'
                  + 'url-prefix("news://"),url-prefix("snews://"){\n'
                    + rules.join('')
                  + '}\n';
      }
    }
    TimeLine.log("done building CSS data");

    // Creating new stylesheet
    if (cssData)
    {
      TimeLine.log("start inserting stylesheet");
      try {
        styleURL = Utils.ioService.newURI("data:text/css;charset=utf8,/*** Adblock Plus ***/" + encodeURIComponent("\n" + cssData), null, null);
        Utils.styleService.loadAndRegisterSheet(styleURL, Ci.nsIStyleSheetService.USER_SHEET);
      } catch(e) {};
      TimeLine.log("done inserting stylesheet");
    }
    TimeLine.leave("ElemHide.apply() done");
  },

  /**
   * Unapplies current stylesheet URL
   */
  unapply: function()
  {
    if (styleURL) {
      try {
        Utils.styleService.unregisterSheet(styleURL, Ci.nsIStyleSheetService.USER_SHEET);
      } catch (e) {}
      styleURL = null;
    }
  }
};

/**
 * Private nsIProtocolHandler implementation
 * @class
 */
var ElemHidePrivate =
{
  classID: Components.ID("{55fb7be0-1dd2-11b2-98e6-9e97caf8ba67}"),
  classDescription: "Element hiding hit registration protocol handler",

  //
  // Factory implementation
  //

  createInstance: function(outer, iid)
  {
    if (outer != null)
      throw Cr.NS_ERROR_NO_AGGREGATION;

    return this.QueryInterface(iid);
  },

  //
  // Protocol handler implementation
  //

  defaultPort: -1,
  protocolFlags: Ci.nsIProtocolHandler.URI_NORELATIVE |
                 Ci.nsIProtocolHandler.URI_NOAUTH |
                 Ci.nsIProtocolHandler.URI_DANGEROUS_TO_LOAD |
                 Ci.nsIProtocolHandler.URI_NON_PERSISTABLE,
  scheme: "abp-elemhidehit-" + Math.random().toFixed(15).substr(5),
  allowPort: function() {return false},

  newURI: function(spec, originCharset, baseURI)
  {
    let url = Cc["@mozilla.org/network/simple-uri;1"].createInstance(Ci.nsIURI);
    url.spec = spec;
    return url;
  },

  newChannel: function(uri)
  {
    if (!/:(\d+)/.test(uri.spec))
      throw Cr.NS_ERROR_FAILURE;

    return new HitRegistrationChannel(uri, RegExp.$1);
  },

  QueryInterface: XPCOMUtils.generateQI([Ci.nsIFactory, Ci.nsIProtocolHandler])
};

/**
 * Channel returning data for element hiding hits.
 * @constructor
 */
function HitRegistrationChannel(uri, key)
{
  this.key = key;
  this.URI = this.originalURI = uri;
}
HitRegistrationChannel.prototype = {
  key: null,
  URI: null,
  originalURI: null,
  contentCharset: "utf-8",
  contentLength: 0,
  contentType: "text/xml",
  owner: null,
  securityInfo: null,
  notificationCallbacks: null,
  loadFlags: 0,
  loadGroup: null,
  name: null,
  status: Cr.NS_OK,

  asyncOpen: function(listener, context)
  {
    let data = "<bindings xmlns='http://www.mozilla.org/xbl'><binding id='dummy'/></bindings>";
    let filter = keys[this.key];
    if (filter)
    {
      let wnd = Utils.getRequestWindow(this);
      if (wnd && wnd.document && !Policy.processNode(wnd, wnd.document, Policy.type.ELEMHIDE, filter))
        data = "<nada/>";
    }

    let stream = Cc["@mozilla.org/io/string-input-stream;1"].createInstance(Ci.nsIStringInputStream);
    stream.setData(data, data.length);

    Utils.runAsync(function()
    {
      try {
        listener.onStartRequest(this, context);
      } catch(e) {}
      try {
        listener.onDataAvailable(this, context, stream, 0, data.length);
      } catch(e) {}
      try {
        listener.onStopRequest(this, context, Cr.NS_OK);
      } catch(e) {}
    }, this);
  },

  open: function()
  {
    throw Cr.NS_ERROR_NOT_IMPLEMENTED;
  },
  isPending: function()
  {
    return false;
  },
  cancel: function()
  {
    throw Cr.NS_ERROR_NOT_IMPLEMENTED;
  },
  suspend: function()
  {
    throw Cr.NS_ERROR_NOT_IMPLEMENTED;
  },
  resume: function()
  {
    throw Cr.NS_ERROR_NOT_IMPLEMENTED;
  },

  QueryInterface: XPCOMUtils.generateQI([Ci.nsIChannel, Ci.nsIRequest])
};
