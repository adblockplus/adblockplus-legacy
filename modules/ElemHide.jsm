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
 * Portions created by the Initial Developer are Copyright (C) 2006-2011
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
Cu.import(baseURL.spec + "FilterClasses.jsm");
Cu.import(baseURL.spec + "TimeLine.jsm");

/**
 * Lookup table, filters by their associated key
 * @type Object
 */
let filterByKey = {__proto__: null};

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
   * Lookup table, keys of the filters by filter text
   * @type Object
   */
  keyByFilter: {__proto__: null},

  /**
   * Called on module startup.
   */
  init: function()
  {
    TimeLine.enter("Entered ElemHide.init()");
    Prefs.addListener(function(name)
    {
      if (name == "enabled")
        ElemHide.apply();
    });
  
    TimeLine.log("done adding prefs listener");

    let styleFile = Utils.resolveFilePath(Prefs.data_directory);
    styleFile.append("elemhide.css");
    styleURL = Utils.ioService.newFileURI(styleFile).QueryInterface(Ci.nsIFileURL);
    TimeLine.log("done determining stylesheet URL");

    TimeLine.log("registering component");
    let registrar = Components.manager.QueryInterface(Ci.nsIComponentRegistrar);
    registrar.registerFactory(ElemHidePrivate.classID, ElemHidePrivate.classDescription,
        "@mozilla.org/network/protocol/about;1?what=" + ElemHidePrivate.aboutPrefix, ElemHidePrivate);

    TimeLine.leave("ElemHide.init() done");
  },

  /**
   * Removes all known filters
   */
  clear: function()
  {
    filterByKey = {__proto__: null};
    ElemHide.keyByFilter = {__proto__: null};
    ElemHide.isDirty = false;
    ElemHide.unapply();
  },

  /**
   * Add a new element hiding filter
   * @param {ElemHideFilter} filter
   */
  add: function(filter)
  {
    if (filter.text in ElemHide.keyByFilter)
      return;

    let key;
    do {
      key = Math.random().toFixed(15).substr(5);
    } while (key in filterByKey);

    filterByKey[key] = filter.text;
    ElemHide.keyByFilter[filter.text] = key;
    ElemHide.isDirty = true;
  },

  /**
   * Removes an element hiding filter
   * @param {ElemHideFilter} filter
   */
  remove: function(filter)
  {
    if (!(filter.text in ElemHide.keyByFilter))
      return;

    let key = ElemHide.keyByFilter[filter.text];
    delete filterByKey[key];
    delete ElemHide.keyByFilter[filter.text];
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

    try
    {
      // Return immediately if disabled
      if (!Prefs.enabled)
      {
        TimeLine.leave("ElemHide.apply() done (disabled)");
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
        let hasFilters = false;
        for (let key in filterByKey)
        {
          let filter = Filter.knownFilters[filterByKey[key]];
          let domain = filter.selectorDomain || "";

          let list;
          if (domain in domains)
            list = domains[domain];
          else
          {
            list = {__proto__: null};
            domains[domain] = list;
          }
          list[filter.selector] = key;
          hasFilters = true;
        }
        TimeLine.log("done grouping selectors");

        if (!hasFilters)
        {
          TimeLine.leave("ElemHide.apply() done (no filters)");
          return;
        }

        // Writing out domains list
        TimeLine.log("start writing CSS data");

        try {
          // Make sure the file's parent directory exists
          styleURL.file.parent.create(Ci.nsIFile.DIRECTORY_TYPE, 0755);
        } catch (e) {}

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
          stream.QueryInterface(Ci.nsISafeOutputStream).finish();
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
    }
    finally
    {
      FilterStorage.triggerObservers("elemhideupdate");
    }
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
  },

  /**
   * Retrieves the currently applied stylesheet URL
   * @type String
   */
  get styleURL() ElemHide.applied ? styleURL.spec : null,

  /**
   * Retrieves an element hiding filter by the corresponding protocol key
   */
  getFilterByKey: function(/**String*/ key) /**Filter*/
  {
    return (key in filterByKey ? Filter.knownFilters[filterByKey[key]] : null);
  },

  /**
   * Stores current state in a JSON'able object.
   */
  toCache: function(/**Object*/ cache)
  {
    cache.elemhide = {filterByKey: filterByKey};
  },

  /**
   * Restores current state from an object.
   */
  fromCache: function(/**Object*/ cache)
  {
    filterByKey = cache.elemhide.filterByKey;
    filterByKey.__proto__ = null;

    // We don't want to initialize keyByFilter yet, do it when it is needed
    delete ElemHide.keyByFilter;
    ElemHide.__defineGetter__("keyByFilter", function()
    {
      let result = {__proto__: null};
      for (let k in filterByKey)
        result[filterByKey[k]] = k;
      return ElemHide.keyByFilter = result;
    });
    ElemHide.__defineSetter__("keyByFilter", function(value)
    {
      delete ElemHide.keyByFilter;
      return ElemHide.keyByFilter = value;
    });
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
    if (this.key in filterByKey)
    {
      let wnd = Utils.getRequestWindow(this);
      if (wnd && wnd.document && !Policy.processNode(wnd, wnd.document, Policy.type.ELEMHIDE, Filter.knownFilters[filterByKey[this.key]]))
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
