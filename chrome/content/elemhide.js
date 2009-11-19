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
 * Portions created by the Initial Developer are Copyright (C) 2006-2009
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *
 * ***** END LICENSE BLOCK ***** */

/**
 * @fileOverview Element hiding implementation.
 * This file is included from AdblockPlus.js.
 */

var styleService = Cc["@mozilla.org/content/style-sheet-service;1"].getService(Ci.nsIStyleSheetService); 

/**
 * Element hiding component
 * @class
 */
var elemhide =
{
  /**
   * Class ID for the protocol handler.
   */
  protoCID: Components.ID("{e3823970-1546-11de-8c30-0800200c9a66}"),

  /**
   * List of known filters
   * @type Array of ElemHideFilter
   */
  filters: [],

  /**
   * Lookup table, has keys for all filters already added
   * @type Object
   */
  knownFilters: {__proto__: null},

  /**
   * Lookup table for filters by their associated key
   * @type Object
   */
  keys: {__proto__: null},

  /**
   * Currently applied stylesheet URL
   * @type nsIURI
   */
  url: null,

  /**
   * Indicates whether filters have been added or removed since the last apply() call.
   * @type Boolean
   */
  isDirty: false,

  /**
   * Initialization function, should be called after policy initialization.
   */
  init: function()
  {
    try {
      let compMgr = Components.manager.QueryInterface(Ci.nsIComponentRegistrar);
      compMgr.registerFactory(this.protoCID, "Element hiding hit registration protocol handler", "@mozilla.org/network/protocol;1?name=" + this.scheme, this);
      policy.whitelistSchemes[this.scheme] = true;
    } catch (e) {}
  },

  /**
   * Removes all known filters
   */
  clear: function()
  {
    this.filters = [];
    this.knownFilters= {__proto__: null};
    this.keys = {__proto__: null};
    this.isDirty = false;
    this.unapply();
  },

  /**
   * Add a new element hiding filter
   * @param {ElemHideFilter} filter
   */
  add: function(filter)
  {
    if (filter.text in this.knownFilters)
      return;

    this.filters.push(filter);

    do {
      filter.key = Math.random().toFixed(15).substr(5);
    } while (filter.key in this.keys);

    this.keys[filter.key] = filter;
    this.knownFilters[filter.text] = true;
    this.isDirty = true;
  },

  /**
   * Removes an element hiding filter
   * @param {ElemHideFilter} filter
   */
  remove: function(filter)
  {
    if (!(filter.text in this.knownFilters))
      return;

    let i = this.filters.indexOf(filter);
    if (i >= 0)
      this.filters.splice(i, 1);

    delete this.keys[filter.key];
    delete this.knownFilters[filter.text];
    this.isDirty = true;
  },

  /**
   * Generates stylesheet URL and applies it globally
   */
  apply: function()
  {
    // Return immediately if nothing to do
    if (!this.url && (!prefs.enabled || !this.filters.length))
      return;

    timeLine.enter("Entered elemhide.apply()");
    this.unapply();
    timeLine.log("elemhide.unapply() finished");

    this.isDirty = false;

    if (!prefs.enabled)
    {
      timeLine.leave("elemhide.apply() done (disabled)");
      return;
    }

    // Grouping selectors by domains
    timeLine.log("start grouping selectors");
    let domains = {__proto__: null};
    for each (var filter in this.filters)
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
    timeLine.log("done grouping selectors");

    // Joining domains list
    timeLine.log("start building CSS data");
    let cssData = "";
    let cssTemplate = "-moz-binding: url(" + this.scheme + "://%ID%/#dummy) !important;";

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
    timeLine.log("done building CSS data");

    // Creating new stylesheet
    if (cssData)
    {
      timeLine.log("start inserting stylesheet");
      try {
        this.url = ioService.newURI("data:text/css;charset=utf8,/*** Adblock Plus ***/" + encodeURIComponent("\n" + cssData), null, null);
        styleService.loadAndRegisterSheet(this.url, styleService.USER_SHEET);
      } catch(e) {};
      timeLine.log("done inserting stylesheet");
    }
    timeLine.leave("elemhide.apply() done");
  },

  /**
   * Unapplies current stylesheet URL
   */
  unapply: function()
  {
    if (this.url) {
      try {
        styleService.unregisterSheet(this.url, styleService.USER_SHEET);
      } catch (e) {}
      this.url = null;
    }
  },

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
  protocolFlags: Ci.nsIProtocolHandler.URI_STD |
                 Ci.nsIProtocolHandler.URI_DANGEROUS_TO_LOAD |
                 Ci.nsIProtocolHandler.URI_NON_PERSISTABLE,
  scheme: "abp-elemhidehit-" + Math.random().toFixed(15).substr(5),
  allowPort: function() {return false},

  newURI: function(spec, originCharset, baseURI)
  {
    var url = Cc["@mozilla.org/network/standard-url;1"].createInstance(Ci.nsIStandardURL);
    url.init(Ci.nsIStandardURL.URLTYPE_STANDARD,
              0, spec, originCharset, baseURI);
    return url;
  },

  newChannel: function(uri)
  {
    if (!/:\/+(\d+)\//.test(uri.spec))
      throw Cr.NS_ERROR_FAILURE;

    return new HitRegistrationChannel(uri, RegExp.$1);
  },

  QueryInterface: XPCOMUtils.generateQI([Ci.nsIFactory, Ci.nsIProtocolHandler])
};
abp.elemhide = elemhide;

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
    let filter = elemhide.keys[this.key];
    if (filter)
    {
      let wnd = getRequestWindow(this);
      if (wnd && wnd.document && !policy.processNode(wnd, wnd.document, policy.type.ELEMHIDE, filter))
        data = "<nada/>";
    }

    let stream = Cc["@mozilla.org/io/string-input-stream;1"].createInstance(Ci.nsIStringInputStream);
    stream.setData(data, data.length);

    runAsync(function()
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
