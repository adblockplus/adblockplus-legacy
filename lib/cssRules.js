/*
 * This file is part of Adblock Plus <https://adblockplus.org/>,
 * Copyright (C) 2006-2016 Eyeo GmbH
 *
 * Adblock Plus is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3 as
 * published by the Free Software Foundation.
 *
 * Adblock Plus is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with Adblock Plus.  If not, see <http://www.gnu.org/licenses/>.
 */

/**
 * @fileOverview CSS property filtering implementation.
 */

let {ElemHide} = require("elemHide");
let {Filter} =  require("filterClasses");

let filters = Object.create(null);

/**
 * CSS rules component
 * @class
 */
let CSSRules = exports.CSSRules =
{
  /**
   * Removes all known filters
   */
  clear: function()
  {
    filters = Object.create(null);
  },

  /**
   * Add a new CSS property filter
   * @param {CSSPropertyFilter} filter
   */
  add: function(filter)
  {
    filters[filter.text] = true;
  },

  /**
   * Removes a CSS property filter
   * @param {CSSPropertyFilter} filter
   */
  remove: function(filter)
  {
    delete filters[filter.text];
  },

  /**
   * Returns a list of all rules active on a particular domain
   * @param {String} domain
   * @return {CSSPropertyFilter[]}
   */
  getRulesForDomain: function(domain)
  {
    let result = [];
    let keys = Object.getOwnPropertyNames(filters);
    for (let key of keys)
    {
      let filter = Filter.fromText(key);
      if (filter.isActiveOnDomain(domain) && !ElemHide.getException(filter, domain))
        result.push(filter);
    }
    return result;
  }
};
