/*
 * This file is part of the Adblock Plus,
 * Copyright (C) 2006-2012 Eyeo GmbH
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

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

Cu.import("resource://gre/modules/Services.jsm");

/**
 * Imports a module from Adblock Plus core.
 */
function require(/**String*/ module)
{
  let result = {};
  result.wrappedJSObject = result;
  Services.obs.notifyObservers(result, "adblockplus-require", module);
  return result.exports;
}

let {Policy} = require("contentPolicy");
let {Filter, InvalidFilter, CommentFilter, ActiveFilter, RegExpFilter,
     BlockingFilter, WhitelistFilter, ElemHideBase, ElemHideFilter, ElemHideException} = require("filterClasses");
let {FilterNotifier} = require("filterNotifier");
let {FilterStorage, PrivateBrowsing} = require("filterStorage");
let {IO} = require("io");
let {defaultMatcher, Matcher, CombinedMatcher} = require("matcher");
let {Prefs} = require("prefs");
let {RequestNotifier} = require("requestNotifier");
let {Subscription, SpecialSubscription, RegularSubscription,
     ExternalSubscription, DownloadableSubscription} = require("subscriptionClasses");
let {Synchronizer} = require("synchronizer");
let {UI} = require("ui");
let {Utils} = require("utils");

/**
 * Shortcut for document.getElementById(id)
 */
function E(id)
{
  return document.getElementById(id);
}
