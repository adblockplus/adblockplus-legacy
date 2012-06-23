/*
 * This Source Code is subject to the terms of the Mozilla Public License
 * version 2.0 (the "License"). You can obtain a copy of the License at
 * http://mozilla.org/MPL/2.0/.
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
