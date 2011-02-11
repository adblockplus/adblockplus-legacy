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
 * @fileOverview Matcher class implementing matching addresses against a list of filters.
 */

var EXPORTED_SYMBOLS = ["Matcher", "CombinedMatcher", "defaultMatcher"];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

let baseURL = Cc["@adblockplus.org/abp/private;1"].getService(Ci.nsIURI);
Cu.import(baseURL.spec + "FilterClasses.jsm");

/**
 * Blacklist/whitelist filter matching
 * @constructor
 */
function Matcher()
{
  this.clear();
}

Matcher.prototype = {
  /**
   * Lookup table for filters by their shortcut
   * @type Object
   */
  shortcutHash: null,

  /**
   * Lookup table, has keys for all filters already added
   * @type Object
   */
  knownFilters: null,

  /**
   * Removes all known filters
   */
  clear: function()
  {
    this.shortcutHash = {__proto__: null};
    this.knownFilters = {__proto__: null};
  },

  /**
   * Adds a filter to the matcher
   * @param {RegExpFilter} filter
   */
  add: function(filter)
  {
    if (filter.text in this.knownFilters)
      return;

    // Look for a suitable shortcut
    let shortcut = this.findShortcut(filter);
    switch (typeof this.shortcutHash[shortcut])
    {
      case "undefined":
        this.shortcutHash[shortcut] = filter.text;
        break;
      case "string":
        this.shortcutHash[shortcut] = [this.shortcutHash[shortcut], filter.text];
        break;
      default:
        this.shortcutHash[shortcut].push(filter.text);
        break;
    }
    this.knownFilters[filter.text] = shortcut;
  },

  /**
   * Removes a filter from the matcher
   * @param {RegExpFilter} filter
   */
  remove: function(filter)
  {
    if (!(filter.text in this.knownFilters))
      return;

    let shortcut = this.knownFilters[filter.text];
    let list = this.shortcutHash[shortcut];
    if (typeof list == "string")
      delete this.shortcutHash[shortcut];
    else
    {
      for (let i = 0, l = list.length; i < l; i++)
        if (list[i] == filter.text)
          list.splice(i--, 1);
    }

    delete this.knownFilters[filter.text];
  },

  /**
   * Looks up a free shortcut for a filter
   * @param {String} text text representation of the filter
   * @return {String} shortcut or null
   */
  findShortcut: function(filter)
  {
    // For donottrack filters use "donottrack" as keyword if nothing else matches
    let defaultResult = (filter.contentType & RegExpFilter.typeMap.DONOTTRACK ? "donottrack" : "");

    let text = filter.text;
    if (Filter.regexpRegExp.test(text))
      return defaultResult;

    // Remove options
    if (Filter.optionsRegExp.test(text))
      text = RegExp.leftContext;

    // Remove whitelist marker
    if (text.substr(0, 2) == "@@")
      text = text.substr(2);

    let candidates = text.toLowerCase().match(/[^a-z0-9%*][a-z0-9%]{3,}(?=[^a-z0-9%*])/g);
    if (!candidates)
      return defaultResult;

    let hash = this.shortcutHash;
    let result = defaultResult;
    let resultCount = 0xFFFFFF;
    let resultLength = 0;
    for (let i = 0, l = candidates.length; i < l; i++)
    {
      let candidate = candidates[i].substr(1);
      let count;
      switch (typeof hash[candidate])
      {
        case "undefined":
          count = 0;
          break;
        case "string":
          count = 1;
          break;
        default:
          count = hash[candidate].length;
          break;
      }
      if (count < resultCount || (count == resultCount && candidate.length > resultLength))
      {
        result = candidate;
        resultCount = count;
        resultLength = candidate.length;
      }
    }
    return result;
  },

  /**
   * Checks whether a particular filter is being matched against.
   */
  hasFilter: function(/**RegExpFilter*/ filter) /**Boolean*/
  {
    return (filter.text in this.knownFilters);
  },

  /**
   * Returns the shortcut used for a filter, null for unknown filters.
   */
  getShortcutForFilter: function(/**RegExpFilter*/ filter) /**String*/
  {
    if (filter.text in this.knownFilters)
      return this.knownFilters[filter.text];
    else
      return null;
  },

  /**
   * Checks whether the entries for a particular shortcut match a URL
   */
  _checkEntryMatch: function(shortcut, location, contentType, docDomain, thirdParty)
  {
    let list = this.shortcutHash[shortcut];
    if (typeof list == "string")
    {
      let filter = Filter.knownFilters[list];
      return (filter.matches(location, contentType, docDomain, thirdParty) ? filter : null);
    }
    else
    {
      for (let i = 0, l = list.length; i < l; i++)
      {
        let filter = Filter.knownFilters[list[i]];
        if (filter.matches(location, contentType, docDomain, thirdParty))
          return filter;
      }
      return null;
    }
  },

  /**
   * Tests whether the URL matches any of the known filters
   * @param {String} location URL to be tested
   * @param {String} contentType content type identifier of the URL
   * @param {String} docDomain domain name of the document that loads the URL
   * @param {Boolean} thirdParty should be true if the URL is a third-party request
   * @return {RegExpFilter} matching filter or null
   */
  matchesAny: function(location, contentType, docDomain, thirdParty)
  {
    let candidates = location.toLowerCase().match(/[a-z0-9%]{3,}/g);
    if (candidates === null)
      candidates = [];
    if (contentType == "DONOTTRACK")
      candidates.unshift("donottrack");
    else
      candidates.push("");
    for (let i = 0, l = candidates.length; i < l; i++)
    {
      let substr = candidates[i];
      if (substr in this.shortcutHash)
      {
        let result = this._checkEntryMatch(substr, location, contentType, docDomain, thirdParty);
        if (result)
          return result;
      }
    }

    return null;
  }
};

/**
 * Combines a matcher for blocking and exception rules, automatically sorts
 * rules into two Matcher instances.
 * @constructor
 */
function CombinedMatcher()
{
  this.blacklist = new Matcher();
  this.whitelist = new Matcher();
  this.resultCache = {__proto__: null};
}

/**
 * Maximal number of matching cache entries to be kept
 * @type Number
 */
CombinedMatcher.maxCacheEntries = 1000;

CombinedMatcher.prototype =
{
  /**
   * Matcher for blocking rules.
   * @type Matcher
   */
  blacklist: null,

  /**
   * Matcher for exception rules.
   * @type Matcher
   */
  whitelist: null,

  /**
   * Lookup table of previous matchesAny results
   * @type Object
   */
  resultCache: null,

  /**
   * Number of entries in resultCache
   * @type Number
   */
  cacheEntries: 0,

  /**
   * @see Matcher#clear
   */
  clear: function()
  {
    this.blacklist.clear();
    this.whitelist.clear();
    this.resultCache = {__proto__: null};
    this.cacheEntries = 0;
  },

  /**
   * @see Matcher#add
   */
  add: function(filter)
  {
    if (filter instanceof WhitelistFilter)
      this.whitelist.add(filter);
    else
      this.blacklist.add(filter);

    if (this.cacheEntries > 0)
    {
      this.resultCache = {__proto__: null};
      this.cacheEntries = 0;
    }
  },

  /**
   * @see Matcher#remove
   */
  remove: function(filter)
  {
    if (filter instanceof WhitelistFilter)
      this.whitelist.remove(filter);
    else
      this.blacklist.remove(filter);

    if (this.cacheEntries > 0)
    {
      this.resultCache = {__proto__: null};
      this.cacheEntries = 0;
    }
  },

  /**
   * @see Matcher#findShortcut
   */
  findShortcut: function(filter)
  {
    if (filter instanceof WhitelistFilter)
      return this.whitelist.findShortcut(filter);
    else
      return this.blacklist.findShortcut(filter);
  },

  /**
   * @see Matcher#hasFilter
   */
  hasFilter: function(filter)
  {
    if (filter instanceof WhitelistFilter)
      return this.whitelist.hasFilter(filter);
    else
      return this.blacklist.hasFilter(filter);
  },

  /**
   * @see Matcher#getShortcutForFilter
   */
  getShortcutForFilter: function(filter)
  {
    if (filter instanceof WhitelistFilter)
      return this.whitelist.getShortcutForFilter(filter);
    else
      return this.blacklist.getShortcutForFilter(filter);
  },

  /**
   * Checks whether a particular filter is slow
   */
  isSlowFilter: function(/**RegExpFilter*/ filter) /**Boolean*/
  {
    let matcher = (filter instanceof WhitelistFilter ? this.whitelist : this.blacklist);
    if (matcher.hasFilter(filter))
      return !matcher.getShortcutForFilter(filter);
    else
      return !matcher.findShortcut(filter);
  },

  /**
   * Optimized filter matching testing both whitelist and blacklist matchers
   * simultaneously. For parameters see Matcher.matchesAny().
   * @see Matcher#matchesAny
   */
  matchesAnyInternal: function(location, contentType, docDomain, thirdParty)
  {
    let candidates = location.toLowerCase().match(/[a-z0-9%]{3,}/g);
    if (candidates === null)
      candidates = [];
    if (contentType == "DONOTTRACK")
      candidates.unshift("donottrack");
    else
      candidates.push("");

    let blacklistHit = null;
    for (let i = 0, l = candidates.length; i < l; i++)
    {
      let substr = candidates[i];
      if (substr in this.whitelist.shortcutHash)
      {
        let result = this.whitelist._checkEntryMatch(substr, location, contentType, docDomain, thirdParty);
        if (result)
          return result;
      }
      if (substr in this.blacklist.shortcutHash && blacklistHit === null)
        blacklistHit = this.blacklist._checkEntryMatch(substr, location, contentType, docDomain, thirdParty);
    }
    return blacklistHit;
  },

  /**
   * @see Matcher#matchesAny
   */
  matchesAny: function(location, contentType, docDomain, thirdParty)
  {
    let key = location + " " + contentType + " " + docDomain + " " + thirdParty;
    if (key in this.resultCache)
      return this.resultCache[key];

    let result = this.matchesAnyInternal(location, contentType, docDomain, thirdParty);

    if (this.cacheEntries >= CombinedMatcher.maxCacheEntries)
    {
      this.resultCache = {__proto__: null};
      this.cacheEntries = 0;
    }

    this.resultCache[key] = result;
    this.cacheEntries++;

    return result;
  }
}


/**
 * Shared CombinedMatcher instance that should usually be used.
 * @type CombinedMatcher
 */
var defaultMatcher = new CombinedMatcher();
