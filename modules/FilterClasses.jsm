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
 * @fileOverview Definition of Filter class and its subclasses.
 */

var EXPORTED_SYMBOLS = ["Filter", "InvalidFilter", "CommentFilter", "ActiveFilter", "RegExpFilter", "BlockingFilter", "WhitelistFilter", "ElemHideFilter"];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

let baseURL = Cc["@adblockplus.org/abp/private;1"].getService(Ci.nsIURI);

Cu.import(baseURL.spec + "Utils.jsm");

/**
 * Abstract base class for filters
 *
 * @param {String} text   string representation of the filter
 * @constructor
 */
function Filter(text)
{
  this.text = text;
  this.subscriptions = [];
}
Filter.prototype =
{
  /**
   * String representation of the filter
   * @type String
   */
  text: null,

  /**
   * Filter subscriptions the filter belongs to
   * @type Array of Subscription
   */
  subscriptions: null,

  /**
   * Serializes the filter to an array of strings for writing out on the disk.
   * @param {Array of String} buffer  buffer to push the serialization results into
   */
  serialize: function(buffer)
  {
    buffer.push("[Filter]");
    buffer.push("text=" + this.text);
  },

  toString: function()
  {
    return this.text;
  }
};

/**
 * Cache for known filters, maps string representation to filter objects.
 * @type Object
 */
Filter.knownFilters = {__proto__: null};

/**
 * Regular expression that element hiding filters should match
 * @type RegExp
 */
Filter.elemhideRegExp = /^([^\/\*\|\@"!]*?)#(?:([\w\-]+|\*)((?:\([\w\-]+(?:[$^*]?=[^\(\)"]*)?\))*)|#([^{}]+))$/;
/**
 * Regular expression that RegExp filters specified as RegExps should match
 * @type RegExp
 */
Filter.regexpRegExp = /^(@@)?\/.*\/(?:\$~?[\w\-]+(?:=[^,\s]+)?(?:,~?[\w\-]+(?:=[^,\s]+)?)*)?$/;
/**
 * Regular expression that options on a RegExp filter should match
 * @type RegExp
 */
Filter.optionsRegExp = /\$(~?[\w\-]+(?:=[^,\s]+)?(?:,~?[\w\-]+(?:=[^,\s]+)?)*)$/;

/**
 * Creates a filter of correct type from its text representation - does the basic parsing and
 * calls the right constructor then.
 *
 * @param {String} text   as in Filter()
 * @return {Filter} filter or null if the filter couldn't be created
 */
Filter.fromText = function(text)
{
  if (!/\S/.test(text))
    return null;

  if (text in Filter.knownFilters)
    return Filter.knownFilters[text];

  let ret;
  if (Filter.elemhideRegExp.test(text))
    ret = ElemHideFilter.fromText(text, RegExp.$1, RegExp.$2, RegExp.$3, RegExp.$4);
  else if (text[0] == "!")
    ret = new CommentFilter(text);
  else
    ret = RegExpFilter.fromText(text);

  Filter.knownFilters[ret.text] = ret;
  return ret;
}

/**
 * Deserializes a filter
 *
 * @param {Object}  obj map of serialized properties and their values
 * @return {Filter} filter or null if the filter couldn't be created
 */
Filter.fromObject = function(obj)
{
  let ret = Filter.fromText(obj.text);
  if (ret instanceof ActiveFilter)
  {
    if ("disabled" in obj)
      ret.disabled = (obj.disabled == "true");
    if ("hitCount" in obj)
      ret.hitCount = parseInt(obj.hitCount) || 0;
    if ("lastHit" in obj)
      ret.lastHit = parseInt(obj.lastHit) || 0;
  }
  return ret;
}

/**
 * Removes unnecessary whitespaces from filter text, will only return null if
 * the input parameter is null.
 */
Filter.normalize = function(/**String*/ text) /**String*/
{
  if (!text)
    return text;

  // Remove line breaks and such
  text = text.replace(/[^\S ]/g, "");

  if (/^\s*!/.test(text)) {
    // Don't remove spaces inside comments
    return text.replace(/^\s+/, "").replace(/\s+$/, "");
  }
  else if (Filter.elemhideRegExp.test(text)) {
    // Special treatment for element hiding filters, right side is allowed to contain spaces
    /^(.*?)(#+)(.*)$/.test(text);   // .split(..., 2) will cut off the end of the string
    var domain = RegExp.$1;
    var separator = RegExp.$2;
    var selector = RegExp.$3;
    return domain.replace(/\s/g, "") + separator + selector.replace(/^\s+/, "").replace(/\s+$/, "");
  }
  else
    return text.replace(/\s/g, "");
}

/**
 * Class for invalid filters
 * @param {String} text see Filter()
 * @param {String} reason Reason why this filter is invalid
 * @constructor
 * @augments Filter
 */
function InvalidFilter(text, reason)
{
  Filter.call(this, text);

  this.reason = reason;
}
InvalidFilter.prototype =
{
  __proto__: Filter.prototype,

  /**
   * Reason why this filter is invalid
   * @type String
   */
  reason: null,

  /**
   * See Filter.serialize()
   */
  serialize: function(buffer) {}
};

/**
 * Class for comments
 * @param {String} text see Filter()
 * @constructor
 * @augments Filter
 */
function CommentFilter(text)
{
  Filter.call(this, text);
}
CommentFilter.prototype =
{
  __proto__: Filter.prototype,

  /**
   * See Filter.serialize()
   */
  serialize: function(buffer) {}
};

/**
 * Abstract base class for filters that can get hits
 * @param {String} text see Filter()
 * @param {String} domains  (optional) Domains that the filter is restricted to separated by domainSeparator e.g. "foo.com|bar.com|~baz.com"
 * @constructor
 * @augments Filter
 */
function ActiveFilter(text, domains)
{
  Filter.call(this, text);

  if (domains)
  {
    this.domainSource = domains;
    this.__defineGetter__("includeDomains", this._getIncludeDomains);
    this.__defineGetter__("excludeDomains", this._getExcludeDomains);
  }
}
ActiveFilter.prototype =
{
  __proto__: Filter.prototype,

  /**
   * Defines whether the filter is disabled
   * @type Boolean
   */
  disabled: false,
  /**
   * Number of hits on the filter since the last reset
   * @type Number
   */
  hitCount: 0,
  /**
   * Last time the filter had a hit (in milliseconds since the beginning of the epoch)
   * @type Number
   */
  lastHit: 0,

  /**
   * String that the includeDomains and excludeDomains properties should be generated from
   * @type String
   */
  domainSource: null,

  /**
   * Separator character used in domainSource property, must be overridden by subclasses
   * @type String
   */
  domainSeparator: null,

  /**
   * Map containing domains that this filter should match on or null if the filter should match on all domains
   * @type Object
   */
  includeDomains: null,
  /**
   * Map containing domains that this filter should not match on or null if the filter should match on all domains
   * @type Object
   */
  excludeDomains: null,

  /**
   * Called first time includeDomains property is requested, triggers _generateDomains method.
   */
  _getIncludeDomains: function()
  {
    this._generateDomains();
    return this.includeDomains;
  },
  /**
   * Called first time excludeDomains property is requested, triggers _generateDomains method.
   */
  _getExcludeDomains: function()
  {
    this._generateDomains();
    return this.excludeDomains;
  },

  /**
   * Generates includeDomains and excludeDomains properties when one of them is requested for the first time.
   */
  _generateDomains: function()
  {
    let domains = this.domainSource.split(this.domainSeparator);

    delete this.domainSource;
    delete this.includeDomains;
    delete this.excludeDomains;

    if (domains.length == 1 && domains[0][0] != "~")
    {
      // Fast track for the common one-domain scenario
      this.includeDomains = {__proto__: null};
      this.includeDomains[domains[0]] = true;
    }
    else
    {
      for each (let domain in domains)
      {
        if (domain == "")
          continue;
  
        let hash = "includeDomains";
        if (domain[0] == "~")
        {
          hash = "excludeDomains";
          domain = domain.substr(1);
        }
  
        if (!this[hash])
          this[hash] = {__proto__: null};
  
        this[hash][domain] = true;
      }
    }
  },

  /**
   * Checks whether this filter is active on a domain.
   */
  isActiveOnDomain: function(/**String*/ docDomain) /**Boolean*/
  {
    // If the document has no host name, match only if the filter isn't restricted to specific domains
    if (!docDomain)
      return (!this.includeDomains);

    if (!this.includeDomains && !this.excludeDomains)
      return true;

    docDomain = docDomain.replace(/\.+$/, "").toUpperCase();

    while (true)
    {
      if (this.includeDomains && docDomain in this.includeDomains)
        return true;
      if (this.excludeDomains && docDomain in this.excludeDomains)
        return false;

      let nextDot = docDomain.indexOf(".");
      if (nextDot < 0)
        break;
      docDomain = docDomain.substr(nextDot + 1);
    }
    return (this.includeDomains == null);
  },

  /**
   * Checks whether this filter is active only on a domain and its subdomains.
   */
  isActiveOnlyOnDomain: function(/**String*/ docDomain) /**Boolean*/
  {
    if (!docDomain || !this.includeDomains)
      return false;

    docDomain = docDomain.replace(/\.+$/, "").toUpperCase();

    for (let domain in this.includeDomains)
      if (domain != docDomain && (domain.length <= docDomain.length || domain.indexOf("." + docDomain) != domain.length - docDomain.length - 1))
        return false;

    return true;
  },

  /**
   * See Filter.serialize()
   */
  serialize: function(buffer)
  {
    if (this.disabled || this.hitCount || this.lastHit)
    {
      Filter.prototype.serialize.call(this, buffer);
      if (this.disabled)
        buffer.push("disabled=true");
      if (this.hitCount)
        buffer.push("hitCount=" + this.hitCount);
      if (this.lastHit)
        buffer.push("lastHit=" + this.lastHit);
    }
  }
};

/**
 * Abstract base class for RegExp-based filters
 * @param {String} text see Filter()
 * @param {String} regexpSource filter part that the regular expression should be build from
 * @param {Number} contentType  (optional) Content types the filter applies to, combination of values from RegExpFilter.typeMap
 * @param {Boolean} matchCase   (optional) Defines whether the filter should distinguish between lower and upper case letters
 * @param {String} domains      (optional) Domains that the filter is restricted to, e.g. "foo.com|bar.com|~baz.com"
 * @param {Boolean} thirdParty  (optional) Defines whether the filter should apply to third-party or first-party content only
 * @constructor
 * @augments ActiveFilter
 */
function RegExpFilter(text, regexpSource, contentType, matchCase, domains, thirdParty)
{
  ActiveFilter.call(this, text, domains);

  if (contentType != null)
    this.contentType = contentType;
  if (matchCase)
    this.matchCase = matchCase;
  if (thirdParty != null)
    this.thirdParty = thirdParty;

  if (regexpSource[0] == "/" && regexpSource[regexpSource.length - 1] == "/")
  {
    // The filter is a regular expression - convert it immediately to catch syntax errors
    this.regexp = new RegExp(regexpSource.substr(1, regexpSource.length - 2), this.matchCase ? "" : "i");
  }
  else
  {
    // No need to convert this filter to regular expression yet, do it on demand
    this.regexpSource = regexpSource;
    this.__defineGetter__("regexp", this._generateRegExp);
  }
}
RegExpFilter.prototype =
{
  __proto__: ActiveFilter.prototype,

  /**
   * @see ActiveFilter.domainSeparator
   */
  domainSeparator: "|",

  /**
   * Expression from which a regular expression should be generated - for delayed creation of the regexp property
   * @type String
   */
  regexpSource: null,
  /**
   * Regular expression to be used when testing against this filter
   * @type RegExp
   */
  regexp: null,
  /**
   * 8 character string identifying this filter for faster matching
   * @type String
   */
  shortcut: null,
  /**
   * Content types the filter applies to, combination of values from RegExpFilter.typeMap
   * @type Number
   */
  contentType: 0x7FFFFFFF,
  /**
   * Defines whether the filter should distinguish between lower and upper case letters
   * @type Boolean
   */
  matchCase: false,
  /**
   * Defines whether the filter should apply to third-party or first-party content only. Can be null (apply to all content).
   * @type Boolean
   */
  thirdParty: null,

  /**
   * Generates regexp property when it is requested for the first time.
   * @return {RegExp}
   */
  _generateRegExp: function()
  {
    // Remove multiple wildcards
    let source = this.regexpSource.replace(/\*+/g, "*");

    // Remove leading wildcards
    if (source[0] == "*")
      source = source.substr(1);

    // Remove trailing wildcards
    let pos = source.length - 1;
    if (source[pos] == "*")
      source = source.substr(0, pos);

    source = source.replace(/\^\|$/, "^")       // remove anchors following separator placeholder
                   .replace(/\W/g, "\\$&")    // escape special symbols
                   .replace(/\\\*/g, ".*")      // replace wildcards by .*
                   // process separator placeholders (all ANSI charaters but alphanumeric characters and _%.-)
                   .replace(/\\\^/g, "(?:[\\x00-\\x24\\x26-\\x2C\\x2F\\x3A-\\x40\\x5B-\\x5E\\x60\\x7B-\\x80]|$)")
                   .replace(/^\\\|\\\|/, "^[\\w\\-]+:\\/+(?!\\/)(?:[^\\/]+\\.)?") // process extended anchor at expression start
                   .replace(/^\\\|/, "^")       // process anchor at expression start
                   .replace(/\\\|$/, "$");      // process anchor at expression end

    let regexp = new RegExp(source, this.matchCase ? "" : "i");

    delete this.regexp;
    delete this.regexpSource;
    return (this.regexp = regexp);
  },

  /**
   * Tests whether the URL matches this filters
   * @param {String} location URL to be tested
   * @param {String} contentType content type identifier of the URL
   * @param {String} docDomain domain name of the document that loads the URL
   * @param {Boolean} thirdParty should be true if the URL is a third-party request
   * @return {Boolean}
   */
  matches: function(location, contentType, docDomain, thirdParty)
  {
    return (this.regexp.test(location) &&
            (RegExpFilter.typeMap[contentType] & this.contentType) != 0 &&
            (this.thirdParty == null || this.thirdParty == thirdParty) &&
            this.isActiveOnDomain(docDomain));
  }
};

/**
 * Creates a RegExp filter from its text representation
 * @param {String} text   same as in Filter()
 */
RegExpFilter.fromText = function(text)
{
  let constructor = BlockingFilter;
  let origText = text;
  if (text.indexOf("@@") == 0)
  {
    constructor = WhitelistFilter;
    text = text.substr(2);
  }

  let contentType = null;
  let matchCase = null;
  let domains = null;
  let thirdParty = null;
  let collapse = null;
  let options;
  if (Filter.optionsRegExp.test(text))
  {
    options = RegExp.$1.toUpperCase().split(",");
    text = RegExp.leftContext;
    for each (let option in options)
    {
      let value;
      [option, value] = option.split("=", 2);
      option = option.replace(/-/, "_");
      if (option in RegExpFilter.typeMap)
      {
        if (contentType == null)
          contentType = 0;
        contentType |= RegExpFilter.typeMap[option];
      }
      else if (option[0] == "~" && option.substr(1) in RegExpFilter.typeMap)
      {
        if (contentType == null)
          contentType = RegExpFilter.prototype.contentType;
        contentType &= ~RegExpFilter.typeMap[option.substr(1)];
      }
      else if (option == "MATCH_CASE")
        matchCase = true;
      else if (option == "DOMAIN" && typeof value != "undefined")
        domains = value;
      else if (option == "THIRD_PARTY")
        thirdParty = true;
      else if (option == "~THIRD_PARTY")
        thirdParty = false;
      else if (option == "COLLAPSE")
        collapse = true;
      else if (option == "~COLLAPSE")
        collapse = false;
    }
  }

  if (constructor == WhitelistFilter && (contentType == null || (contentType & RegExpFilter.typeMap.DOCUMENT)) &&
      (!options || options.indexOf("DOCUMENT") < 0) && !/^\|?[\w\-]+:/.test(text))
  {
    // Exception filters shouldn't apply to pages by default unless they start with a protocol name
    if (contentType == null)
      contentType = RegExpFilter.prototype.contentType;
    contentType &= ~RegExpFilter.typeMap.DOCUMENT;
  }

  try
  {
    return new constructor(origText, text, contentType, matchCase, domains, thirdParty, collapse);
  }
  catch (e)
  {
    return new InvalidFilter(text, e);
  }
}

/**
 * Maps type strings like "SCRIPT" or "OBJECT" to bit masks
 */
RegExpFilter.typeMap = {
  OTHER: 1,
  SCRIPT: 2,
  IMAGE: 4,
  STYLESHEET: 8,
  OBJECT: 16,
  SUBDOCUMENT: 32,
  DOCUMENT: 64,
  XBL: 512,
  PING: 1024,
  XMLHTTPREQUEST: 2048,
  OBJECT_SUBREQUEST: 4096,
  DTD: 8192,
  MEDIA: 16384,
  FONT: 32768,

  BACKGROUND: 4,    // Backwards compat, same as IMAGE

  ELEMHIDE: 0x40000000
};

// ELEMHIDE option shouldn't be there by default
RegExpFilter.prototype.contentType &= ~RegExpFilter.typeMap.ELEMHIDE;

/**
 * Class for blocking filters
 * @param {String} text see Filter()
 * @param {String} regexpSource see RegExpFilter()
 * @param {Number} contentType see RegExpFilter()
 * @param {Boolean} matchCase see RegExpFilter()
 * @param {String} domains see RegExpFilter()
 * @param {Boolean} thirdParty see RegExpFilter()
 * @param {Boolean} collapse  defines whether the filter should collapse blocked content, can be null
 * @constructor
 * @augments RegExpFilter
 */
function BlockingFilter(text, regexpSource, contentType, matchCase, domains, thirdParty, collapse)
{
  RegExpFilter.call(this, text, regexpSource, contentType, matchCase, domains, thirdParty);

  this.collapse = collapse;
}
BlockingFilter.prototype =
{
  __proto__: RegExpFilter.prototype,

  /**
   * Defines whether the filter should collapse blocked content. Can be null (use the global preference).
   * @type Boolean
   */
  collapse: null
};

/**
 * Class for whitelist filters
 * @param {String} text see Filter()
 * @param {String} regexpSource see RegExpFilter()
 * @param {Number} contentType see RegExpFilter()
 * @param {Boolean} matchCase see RegExpFilter()
 * @param {String} domains see RegExpFilter()
 * @param {Boolean} thirdParty see RegExpFilter()
 * @constructor
 * @augments RegExpFilter
 */
function WhitelistFilter(text, regexpSource, contentType, matchCase, domains, thirdParty)
{
  RegExpFilter.call(this, text, regexpSource, contentType, matchCase, domains, thirdParty);
}
WhitelistFilter.prototype =
{
  __proto__: RegExpFilter.prototype
}

/**
 * Class for element hiding filters
 * @param {String} text see Filter()
 * @param {String} domains    (optional) Host names or domains the filter should be restricted to
 * @param {String} selector   CSS selector for the HTML elements that should be hidden
 * @constructor
 * @augments ActiveFilter
 */
function ElemHideFilter(text, domains, selector)
{
  ActiveFilter.call(this, text, domains ? domains.toUpperCase() : null);

  if (domains)
    this.selectorDomain = domains.replace(/,~[^,]+/g, "").replace(/^~[^,]+,?/, "").toLowerCase();
  this.selector = selector;
}
ElemHideFilter.prototype =
{
  __proto__: ActiveFilter.prototype,

  /**
   * @see ActiveFilter.domainSeparator
   */
  domainSeparator: ",",

  /**
   * Host name or domain the filter should be restricted to (can be null for no restriction)
   * @type String
   */
  selectorDomain: null,
  /**
   * CSS selector for the HTML elements that should be hidden
   * @type String
   */
  selector: null,

  /**
   * Random key associated with the filter - used to register hits from element hiding filters
   * @type String
   */
  key: null
};

/**
 * Creates an element hiding filter from a pre-parsed text representation
 *
 * @param {String} text       same as in Filter()
 * @param {String} domain     domain part of the text representation (can be empty)
 * @param {String} tagName    tag name part (can be empty)
 * @param {String} attrRules  attribute matching rules (can be empty)
 * @param {String} selector   raw CSS selector (can be empty)
 * @return {ElemHideFilter or InvalidFilter}
 */
ElemHideFilter.fromText = function(text, domain, tagName, attrRules, selector)
{
  if (!selector)
  {
    if (tagName == "*")
      tagName = "";

    let id = null;
    let additional = "";
    if (attrRules) {
      attrRules = attrRules.match(/\([\w\-]+(?:[$^*]?=[^\(\)"]*)?\)/g);
      for each (let rule in attrRules) {
        rule = rule.substr(1, rule.length - 2);
        let separatorPos = rule.indexOf("=");
        if (separatorPos > 0) {
          rule = rule.replace(/=/, '="') + '"';
          additional += "[" + rule + "]";
        }
        else {
          if (id)
            return new InvalidFilter(text, Utils.getString("filter_elemhide_duplicate_id"));
          else
            id = rule;
        }
      }
    }

    if (id)
      selector = tagName + "." + id + additional + "," + tagName + "#" + id + additional;
    else if (tagName || additional)
      selector = tagName + additional;
    else
      return new InvalidFilter(text, Utils.getString("filter_elemhide_nocriteria"));
  }
  return new ElemHideFilter(text, domain, selector);
}
