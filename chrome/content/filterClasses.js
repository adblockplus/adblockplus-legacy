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
 * Definition of Filter class and its subclasses.
 * This file is included from nsAdblockPlus.js.
 */

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
    let buffer = [];
    this.serialize(buffer);
    return buffer.join("\n");
  }
};
abp.Filter = Filter;

/**
 * Cache for known filters, maps string representation to filter objects.
 * @type Object
 */
Filter.knownFilters = {__proto__: null};

/**
 * Regular expression that element hiding filters should match
 * @type RegExp
 */
Filter.elemhideRegExp = /^([^\/\*\|\@"]*?)#(?:([\w\-]+|\*)((?:\([\w\-]+(?:[$^*]?=[^\(\)"]*)?\))*)|#([^{}]+))$/;
/**
 * Regular expression that RegExp filters specified as RegExps should match (with options already removed)
 * @type RegExp
 */
Filter.regexpRegExp = /^(@@)?\/.*\/(?:\$~?[\w\-]+(?:,~?[\w\-]+)*)?$/;
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
  let ret = null;
  switch (obj.type)
  {
    case "invalid":
      ret = Filter.fromText(obj.text);
      break;
    case "comment":
      ret = new CommentFilter(obj.text);
      break;
    case "filterlist":
      if (filterStorage.fileProperties.version != filterStorage.formatVersion)
        ret = new Filter.fromText(obj.text);
      else
      {
        let contentType = null;
        if ("contentType" in obj)
          contentType = parseInt(obj.contentType) || null;

        let matchCase = null;
        if ("matchCase" in obj)
          matchCase = (obj.matchCase == "true");

        let domains = null;
        if ("domains" in obj)
          domains = obj.domains;

        let thirdParty = null;
        if ("thirdParty" in obj)
          thirdParty = (obj.thirdParty == "true");

        let collapse = null;
        if ("collapse" in obj)
          collapse = (obj.collapse == "true");

        ret = new BlockingFilter(obj.text, obj.regexp, contentType, matchCase, domains, thirdParty, collapse);
      }
      break;
    case "whitelist":
      if (filterStorage.fileProperties.version != filterStorage.formatVersion)
        ret = new Filter.fromText(obj.text);
      else
      {
        let contentType = null;
        if ("contentType" in obj)
          contentType = parseInt(obj.contentType) || null;

        let matchCase = null;
        if ("matchCase" in obj)
          matchCase = (obj.matchCase == "true");

        let domains = null;
        if ("domains" in obj)
          domains = obj.domains;

        let thirdParty = null;
        if ("thirdParty" in obj)
          thirdParty = (obj.thirdParty == "true");

        ret = new WhitelistFilter(obj.text, obj.regexp, contentType, matchCase, domains, thirdParty);
      }
      break;
    case "elemhide":
      ret = new ElemHideFilter(obj.text, obj.domain, obj.selector);
      break;
    default:
      return null;
  }

  if (ret instanceof ActiveFilter)
  {
    if ("disabled" in obj)
      ret.disabled = (obj.disabled == "true");
    if ("hitCount" in obj)
      ret.hitCount = parseInt(obj.hitCount) || 0;
    if ("lastHit" in obj)
      ret.lastHit = parseInt(obj.lastHit) || 0;
  }

  if (ret instanceof RegExpFilter && "shortcut" in obj && obj.shortcut.length == Matcher.shortcutLength)
    ret.shortcut = obj.shortcut;
  
  Filter.knownFilters[ret.text] = ret;
  return ret;
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
  serialize: function(buffer)
  {
    Filter.prototype.serialize.call(this, buffer);
    buffer.push("type=invalid");
  }
};
abp.InvalidFilter = InvalidFilter;

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
  serialize: function(buffer)
  {
    Filter.prototype.serialize.call(this, buffer);
    buffer.push("type=comment");
  }
};
abp.CommentFilter = CommentFilter;

/**
 * Abstract base class for filters that can get hits
 * @param {String} text see Filter()
 * @constructor
 * @augments Filter
 */
function ActiveFilter(text)
{
  Filter.call(this, text);
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
   * See Filter.serialize()
   */
  serialize: function(buffer)
  {
    Filter.prototype.serialize.call(this, buffer);
    if (this.disabled)
      buffer.push("disabled=true");
    if (this.hitCount)
      buffer.push("hitCount=" + this.hitCount);
    if (this.lastHit)
      buffer.push("lastHit=" + this.lastHit);
  }
};
abp.ActiveFilter = ActiveFilter;

/**
 * Abstract base class for RegExp-based filters
 * @param {String} text see Filter()
 * @param {String} regexp       regular expression this filter should use
 * @param {Number} contentType  (optional) Content types the filter applies to, combination of values from RegExpFilter.typeMap
 * @param {Boolean} matchCase   (optional) Defines whether the filter should distinguish between lower and upper case letters
 * @param {String} domains      (optional) Domains that the filter is restricted to, e.g. "foo.com|bar.com|~baz.com"
 * @param {Boolean} thirdParty  (optional) Defines whether the filter should apply to third-party or first-party content only
 * @constructor
 * @augments ActiveFilter
 */
function RegExpFilter(text, regexp, contentType, matchCase, domains, thirdParty)
{
  ActiveFilter.call(this, text);

  if (contentType != null)
    this.contentType = contentType;
  if (matchCase)
    this.matchCase = matchCase;
  if (domains != null)
  {
    this.domains = domains;
    for each (let domain in domains.split("|"))
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
  if (thirdParty != null)
    this.thirdParty = thirdParty;

  this.regexp = new RegExp(regexp, this.matchCase ? "" : "i");
}
RegExpFilter.prototype =
{
  __proto__: ActiveFilter.prototype,

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
   * String representation of the domains the filter should be restricted to, e.g. "foo.com|bar.com|~baz.com"
   * @type String
   */
  domains: null,
  /**
   * Defines whether the filter should apply to third-party or first-party content only. Can be null (apply to all content).
   * @type Boolean
   */
  thirdParty: null,

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
   * Checks whether this filter is active on a domain.
   */
  isActiveOnDomain: function(/**String*/ docDomain) /**Boolean*/
  {
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
            (!docDomain || this.isActiveOnDomain(docDomain)));
  },

  /**
   * See Filter.serialize()
   */
  serialize: function(buffer)
  {
    ActiveFilter.prototype.serialize.call(this, buffer);
    buffer.push("regexp=" + this.regexp.source);
    if (this.shortcut)
      buffer.push("shortcut=" + this.shortcut);
    if (this.hasOwnProperty("contentType"))
      buffer.push("contentType=" + this.contentType);
    if (this.matchCase)
      buffer.push("matchCase=" + this.matchCase);
    if (this.domains != null)
      buffer.push("domains=" + this.domains);
    if (this.thirdParty != null)
      buffer.push("thirdParty=" + this.thirdParty);
  }
};
abp.RegExpFilter = RegExpFilter;

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
    text = text.replace(Filter.optionsRegExp, "");
    for each (let option in options)
    {
      let value;
      [option, value] = option.split("=");
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
          contentType = 0x7FFFFFFF;
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

  let regexp;
  if (text[0] == "/" && text[text.length - 1] == "/")   // filter is a regexp already
  {
    regexp = text.substr(1, text.length - 2);
  }
  else
  {
    regexp = text.replace(/\*+/g, "*")        // remove multiple wildcards
                 .replace(/(\W)/g, "\\$1")    // escape special symbols
                 .replace(/\\\*/g, ".*")      // replace wildcards by .*
                 .replace(/^\\\|/, "^")       // process anchor at expression start
                 .replace(/\\\|$/, "$")       // process anchor at expression end
                 .replace(/^(\.\*)/,"")       // remove leading wildcards
                 .replace(/(\.\*)$/,"");      // remove trailing wildcards 
  }
  if (regexp == "")
    regexp = ".*";

  if (constructor == WhitelistFilter && (contentType == null || (contentType & RegExpFilter.typeMap.DOCUMENT)) &&
      (!options || options.indexOf("DOCUMENT") < 0) && !/^\|?[\w\-]+:/.test(text))
  {
    // Exception filters shouldn't apply to pages by default unless they start with a protocol name
    if (contentType == null)
      contentType = 0x7FFFFFFF;
    contentType &= ~RegExpFilter.typeMap.DOCUMENT;
  }

  try
  {
    return new constructor(origText, regexp, contentType, matchCase, domains, thirdParty, collapse);
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
  BACKGROUND: 256,
  XBL: 512,
  PING: 1024,
  XMLHTTPREQUEST: 2048,
  OBJECT_SUBREQUEST: 4096,
  DTD: 8192,
  MEDIA: 16384
};

/**
 * Class for blocking filters
 * @param {String} text see Filter()
 * @param {String} regexp see RegExpFilter()
 * @param {Number} contentType see RegExpFilter()
 * @param {Boolean} matchCase see RegExpFilter()
 * @param {String} domains see RegExpFilter()
 * @param {Boolean} thirdParty see RegExpFilter()
 * @param {Boolean} collapse  defines whether the filter should collapse blocked content, can be null
 * @constructor
 * @augments RegExpFilter
 */
function BlockingFilter(text, regexp, contentType, matchCase, domains, thirdParty, collapse)
{
  RegExpFilter.call(this, text, regexp, contentType, matchCase, domains, thirdParty);

  this.collapse = collapse;
}
BlockingFilter.prototype =
{
  __proto__: RegExpFilter.prototype,

  /**
   * Defines whether the filter should collapse blocked content. Can be null (use the global preference).
   * @type Boolean
   */
  collapse: null,

  /**
   * See Filter.serialize()
   */
  serialize: function(buffer)
  {
    RegExpFilter.prototype.serialize.call(this, buffer);
    buffer.push("type=filterlist");
    if (this.collapse != null)
      buffer.push("collapse=" + this.collapse);
  }
};
abp.BlockingFilter = BlockingFilter;

/**
 * Class for whitelist filters
 * @param {String} text see Filter()
 * @param {String} regexp see RegExpFilter()
 * @param {Number} contentType see RegExpFilter()
 * @param {Boolean} matchCase see RegExpFilter()
 * @param {String} domains see RegExpFilter()
 * @param {Boolean} thirdParty see RegExpFilter()
 * @constructor
 * @augments RegExpFilter
 */
function WhitelistFilter(text, regexp, contentType, matchCase, domains, thirdParty)
{
  RegExpFilter.call(this, text, regexp, contentType, matchCase, domains, thirdParty);
}
WhitelistFilter.prototype =
{
  __proto__: RegExpFilter.prototype,

  /**
   * See Filter.serialize()
   */
  serialize: function(buffer)
  {
    RegExpFilter.prototype.serialize.call(this, buffer);
    buffer.push("type=whitelist");
  }
};
abp.WhitelistFilter = WhitelistFilter;

/**
 * Class for element hiding filters
 * @param {String} text see Filter()
 * @param {String} domain     Host name or domain the filter should be restricted to (can be null for no restriction)
 * @param {String} selector   CSS selector for the HTML elements that should be hidden
 * @constructor
 * @augments ActiveFilter
 */
function ElemHideFilter(text, domain, selector)
{
  ActiveFilter.call(this, text);

  this.domain = domain;
  this.selector = selector;
}
ElemHideFilter.prototype =
{
  __proto__: ActiveFilter.prototype,

  /**
   * Host name or domain the filter should be restricted to (can be null for no restriction)
   * @type String
   */
  domain: null,
  /**
   * CSS selector for the HTML elements that should be hidden
   * @type String
   */
  selector: null,

  /**
   * Random key associated with the filter - used to register hits from element hiding filters
   * @type String
   */
  key: null,

  /**
   * See Filter.serialize()
   */
  serialize: function(buffer)
  {
    ActiveFilter.prototype.serialize.call(this, buffer);
    buffer.push("type=elemhide");
    if (this.domain)
      buffer.push("domain=" + this.domain);
    if (this.selector)
      buffer.push("selector=" + this.selector);
  }
};
abp.ElemHideFilter = ElemHideFilter;

/**
 * Creates an element hiding filter from a pre-parsed text representation
 *
 * @param {String} text       same as in Filter()
 * @param {String} domain     (optional) domain part of the text representation
 * @param {String} tagName    (optional) tag name part
 * @param {String} attrRules  (optional) attribute matching rules
 * @param {String} selector   (optional) raw CSS selector
 * @return {ElemHideFilter or InvalidFilter}
 */
ElemHideFilter.fromText = function(text, domain, tagName, attrRules, selector)
{
  domain = domain.replace(/^,+/, "").replace(/,+$/, "").replace(/,+/g, ",");

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
            return new InvalidFilter(text, abp.getString("filter_elemhide_duplicate_id"));
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
      return new InvalidFilter(text, abp.getString("filter_elemhide_nocriteria"));
  }
  return new ElemHideFilter(text, domain, selector);
}
