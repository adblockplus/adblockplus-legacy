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
 * Element hiding implementation.
 * This file is included from nsAdblockPlus.js.
 */

var styleService = Components.classes["@mozilla.org/content/style-sheet-service;1"]
                             .getService(Components.interfaces.nsIStyleSheetService); 

/**
 * Element hiding component
 * @class
 */
var elemhide =
{
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
   * Removes all known filters
   */
  clear: function() {
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
  apply: function() {
    this.unapply();
    this.isDirty = false;

    if (!prefs.enabled)
      return;

    // Grouping selectors by domains
    let domains = {__proto__: null};
    for each (var filter in this.filters)
    {
      let domain = filter.domain || "";

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

    // Joining domains list
    let cssData = "";
    for (let domain in domains)
    {
      let rules = [];
      let list = domains[domain];
      for (let selector in list)
      {
        // Firefox 2 does not apply bindings to table rows and cells, need to
        // change the value for display here. display:none won't work because
        // invisible elements cannot have bindings but elements with misapplied
        // bindings are hidden anyway.
        rules.push(selector + "{display: inline !important; -moz-binding: url(chrome://global/content/bindings/general.xml?abphit:" + list[selector] + "#basecontrol) !important;}\n");
      }

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

    // Creating new stylesheet
    if (cssData)
    {
      try {
        this.url = ioService.newURI("data:text/css;charset=utf8,/*** Adblock Plus ***/" + encodeURIComponent("\n" + cssData), null, null);
        styleService.loadAndRegisterSheet(this.url, styleService.USER_SHEET);
      } catch(e) {};
    }
  },

  /**
   * Unapplies current stylesheet URL
   */
  unapply: function() {
    if (this.url) {
      try {
        styleService.unregisterSheet(this.url, styleService.USER_SHEET);
      } catch (e) {}
      this.url = null;
    }
  }
};
abp.elemhide = elemhide;
