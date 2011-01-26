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
Cu.import(baseURL.spec + "FilterStorage.jsm");
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
   * Inidicates whether the element hiding stylesheet is currently applied.
   * @type Boolean
   */
  applied: false,

  /**
   * Called on module startup.
   */
  startup: function()
  {
    TimeLine.enter("Entered ElemHide.startup()");
    Prefs.addListener(function(name)
    {
      if (name == "enabled")
        ElemHide.apply();
    });
  
    TimeLine.log("done adding prefs listener");

    let styleFile = FilterStorage.sourceFile.parent.clone();
    styleFile.append("elemhide.css");
    styleURL = Utils.ioService.newFileURI(styleFile).QueryInterface(Ci.nsIFileURL);
    TimeLine.log("done determining stylesheet URL");

    TimeLine.log("registering component");
    let registrar = Components.manager.QueryInterface(Ci.nsIComponentRegistrar);
    registrar.registerFactory(ElemHidePrivate.classID, ElemHidePrivate.classDescription,
        "@mozilla.org/network/protocol/about;1?what=" + ElemHidePrivate.aboutPrefix, ElemHidePrivate);

    TimeLine.leave("ElemHide.startup() done");
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
    TimeLine.enter("Entered ElemHide.apply()");

    if (ElemHide.applied)
      ElemHide.unapply();
    TimeLine.log("ElemHide.unapply() finished");

    // Return immediately if nothing to do
    if (!Prefs.enabled || !filters.length)
    {
      TimeLine.leave("ElemHide.apply() done (disabled/no filters)");
      return;
    }

    // CSS file doesn't need to be rewritten if nothing changed (e.g. we
    // were disabled and reenabled)
    if (ElemHide.isDirty)
    {
      ElemHide.isDirty = false;

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

      // Writing out domains list
      TimeLine.log("start writing CSS data");
      let stream;
      try
      {
        stream = Cc["@mozilla.org/network/safe-file-output-stream;1"].createInstance(Ci.nsIFileOutputStream);
        stream.init(styleURL.file, 0x02 | 0x08 | 0x20, 0644, 0);
      }
      catch (e)
      {
        Cu.reportError(e);
        TimeLine.leave("ElemHide.apply() done (error opening file)");
        return;
      }

      let buf = [];
      let maxBufLen = 1024;
      function escapeChar(match)
      {
        return "\\" + match.charCodeAt(0).toString(16) + " ";
      }
      function writeString(str, forceWrite)
      {
        buf.push(str);
        if (buf.length >= maxBufLen || forceWrite)
        {
          let output = buf.join("").replace(/[^\x01-\x7F]/g, escapeChar);
          stream.write(output, output.length);
          buf.splice(0, buf.length);
        }
      }

      let cssTemplate = "-moz-binding: url(about:" + ElemHidePrivate.aboutPrefix + "?%ID%#dummy) !important;";
      for (let domain in domains)
      {
        let rules = [];
        let list = domains[domain];

        if (domain)
          writeString('@-moz-document domain("' + domain.split(",").join('"),domain("') + '"){\n');
        else
        {
          // Only allow unqualified rules on a few protocols to prevent them from blocking chrome
          writeString('@-moz-document url-prefix("http://"),url-prefix("https://"),'
                    + 'url-prefix("mailbox://"),url-prefix("imap://"),'
                    + 'url-prefix("news://"),url-prefix("snews://"){\n');
        }

        for (let selector in list)
          writeString(selector + "{" + cssTemplate.replace("%ID%", list[selector]) + "}\n");
        writeString('}\n');
      }
      writeString("", true);
      try
      {
        if (stream instanceof Ci.nsISafeOutputStream)
          stream.finish();
        else
          stream.close();
      }
      catch(e)
      {
        Cu.reportError(e);
        TimeLine.leave("ElemHide.apply() done (error closing file)");
        return;
      }
      TimeLine.log("done writing CSS data");
    }

    // Inserting new stylesheet
    TimeLine.log("start inserting stylesheet");
    try
    {
      Utils.styleService.loadAndRegisterSheet(styleURL, Ci.nsIStyleSheetService.USER_SHEET);
      ElemHide.applied = true;
    }
    catch (e)
    {
      Cu.reportError(e);
    }
    TimeLine.leave("ElemHide.apply() done");
  },

  /**
   * Unapplies current stylesheet URL
   */
  unapply: function()
  {
    if (ElemHide.applied)
    {
      try
      {
        Utils.styleService.unregisterSheet(styleURL, Ci.nsIStyleSheetService.USER_SHEET);
      }
      catch (e)
      {
        Cu.reportError(e);
      }
      ElemHide.applied = false;
    }
  }
};

/**
 * Private nsIAboutModule implementation
 * @class
 */
var ElemHidePrivate =
{
  classID: Components.ID("{55fb7be0-1dd2-11b2-98e6-9e97caf8ba67}"),
  classDescription: "Element hiding hit registration protocol handler",
  aboutPrefix: "abp-elemhidehit",

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
  // About module implementation
  //

  getURIFlags: function(uri)
  {
    return Ci.nsIAboutModule.HIDE_FROM_ABOUTABOUT;
  },

  newChannel: function(uri)
  {
    if (!/\?(\d+)/.test(uri.path))
      throw Cr.NS_ERROR_FAILURE;

    return new HitRegistrationChannel(uri, RegExp.$1);
  },

  QueryInterface: XPCOMUtils.generateQI([Ci.nsIFactory, Ci.nsIAboutModule])
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
  owner: Utils.systemPrincipal,
  securityInfo: null,
  notificationCallbacks: null,
  loadFlags: 0,
  loadGroup: null,
  name: null,
  status: Cr.NS_OK,

  asyncOpen: function(listener, context)
  {
    let stream = this.open();
    Utils.runAsync(function()
    {
      try {
        listener.onStartRequest(this, context);
      } catch(e) {}
      try {
        listener.onDataAvailable(this, context, stream, 0, stream.available());
      } catch(e) {}
      try {
        listener.onStopRequest(this, context, Cr.NS_OK);
      } catch(e) {}
    }, this);
  },

  open: function()
  {
    let data = "<bindings xmlns='http://www.mozilla.org/xbl'><binding id='dummy'/></bindings>";
    let filter = keys[this.key];
    if (filter)
    {
      let wnd = Utils.getRequestWindow(this);
      if (wnd && wnd.document && !Policy.processNode(wnd, wnd.document, Policy.type.ELEMHIDE, filter))
        data = "<bindings xmlns='http://www.mozilla.org/xbl'/>";
    }

    let stream = Cc["@mozilla.org/io/string-input-stream;1"].createInstance(Ci.nsIStringInputStream);
    stream.setData(data, data.length);
    return stream;
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
