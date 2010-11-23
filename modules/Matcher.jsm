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
   * Should be true if shortcutHash has any entries
   * @type Boolean
   */
  hasShortcuts: false,

  /**
   * Filters without a shortcut
   * @type Array of RegExpFilter
   */
  regexps: null,

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
    this.hasShortcuts = false;
    this.regexps = [];
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

    // Look for a suitable shortcut if the filter doesn't have one
    if (!filter.shortcut)
      filter.shortcut = this.findShortcut(filter.text);

    if (filter.shortcut)
    {
      if (filter.shortcut in this.shortcutHash)
        this.shortcutHash[filter.shortcut] = this.shortcutHash[filter.shortcut].pushFilter(filter);
      else
        this.shortcutHash[filter.shortcut] = filter;
      this.hasShortcuts = true;
    }
    else 
      this.regexps.push(filter);

    this.knownFilters[filter.text] = true;
  },

  /**
   * Removes a filter from the matcher
   * @param {RegExpFilter} filter
   */
  remove: function(filter)
  {
    if (!(filter.text in this.knownFilters))
      return;

    if (filter.shortcut)
    {
      if ("filters" in this.shortcutHash[filter.shortcut])
      {
        list = this.shortcutHash[filter.shortcut].filters;
        for (let i = 0, l = list.length; i < l; i++)
          if (i == filter)
            list.splice(i--, 1);
      }
      else
        delete this.shortcutHash[filter.shortcut];
    }
    else
    {
      let i = this.regexps.indexOf(filter);
      if (i >= 0)
        this.regexps.splice(i, 1);
    }

    delete this.knownFilters[filter.text];
  },

  /**
   * Looks up a free shortcut for a filter
   * @param {String} text text representation of the filter
   * @return {String} shortcut or null
   */
  findShortcut: function(text)
  {
    if (Filter.regexpRegExp.test(text))
      return null;

    // Remove options
    if (Filter.optionsRegExp.test(text))
      text = RegExp.leftContext;

    // Remove whitelist marker
    if (text.substr(0, 2) == "@@")
      text = text.substr(2);

    let candidates = text.toLowerCase().match(/[^a-z0-9%*][a-z0-9%]{3,}(?=[^a-z0-9%*])/g);
    if (!candidates)
      return null;

    let hash = this.shortcutHash;
    let result = null;
    let resultCount = Infinity;
    let resultLength = 0;
    for (let i = 0, l = candidates.length; i < l; i++)
    {
      let candidate = candidates[i].substr(1);
      let count = candidate in hash ? hash[candidate].filterCount : 0;
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
   * Tests whether the URL matches any of the known filters
   * @param {String} location URL to be tested
   * @param {String} contentType content type identifier of the URL
   * @param {String} docDomain domain name of the document that loads the URL
   * @param {Boolean} thirdParty should be true if the URL is a third-party request
   * @return {RegExpFilter} matching filter or null
   */
  matchesAny: function(location, contentType, docDomain, thirdParty)
  {
    if (this.hasShortcuts)
    {
      // Optimized matching using shortcuts
      let candidates = location.toLowerCase().match(/[a-z0-9%]{3,}/g);
      if (candidates)
      {
        for (let i = 0, l = candidates.length; i < l; i++)
        {
          let substr = candidates[i];
          if (substr in this.shortcutHash)
          {
            let result = this.shortcutHash[substr].matches(location, contentType, docDomain, thirdParty);
            if (result)
              return result;
          }
        }
      }
    }

    // Slow matching for filters without shortcut
    for each (let filter in this.regexps)
      if (filter.matches(location, contentType, docDomain, thirdParty))
        return filter;

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
  findShortcut: function(text)
  {
    if (text.substr(0, 2) == "@@")
      return this.whitelist.findShortcut(text);
    else
      return this.blacklist.findShortcut(text);
  },

  /**
   * Optimized filter matching testing both whitelist and blacklist matchers
   * simultaneously. For parameters see Matcher.matchesAny().
   * @see Matcher#matchesAny
   */
  matchesAnyInternal: function(location, contentType, docDomain, thirdParty)
  {
    let blacklistHit = null;
    if (this.whitelist.hasShortcuts || this.blacklist.hasShortcuts)
    {
      // Optimized matching using shortcuts
      let hashWhite = this.whitelist.shortcutHash;
      let hashBlack = this.blacklist.shortcutHash;

      let candidates = location.toLowerCase().match(/[a-z0-9%]{3,}/g);
      if (candidates)
      {
        for (let i = 0, l = candidates.length; i < l; i++)
        {
          let substr = candidates[i];
          if (substr in hashWhite)
          {
            let result = hashWhite[substr].matches(location, contentType, docDomain, thirdParty);
            if (result)
              return result;
          }
          if (substr in hashBlack)
          {
            let result = hashBlack[substr].matches(location, contentType, docDomain, thirdParty);
            if (result)
              blacklistHit = result;
          }
        }
      }
    }

    // Slow matching for filters without shortcut
    for each (let filter in this.whitelist.regexps)
      if (filter.matches(location, contentType, docDomain, thirdParty))
        return filter;

    if (blacklistHit)
      return blacklistHit;

    for each (let filter in this.blacklist.regexps)
      if (filter.matches(location, contentType, docDomain, thirdParty))
        return filter;

    return null;
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
