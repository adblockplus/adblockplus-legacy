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

Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");

let {Prefs} = require("prefs");
let {WindowObserver} = require("windowObserver");
let {getSchemeCorrection, isKnownScheme, getDomainCorrection, getDomainReferral, onWhitelistEntryAdded} = require("typoRules");
let {processTypedDomain, processDomainCorrection, processFalsePositive} = require("typoCollector");
let appIntegration = require("typoAppIntegration");
let netError = require("typoNetError");

let typoWindowObserver = null;

exports.attachWindowObserver = attachWindowObserver;
function attachWindowObserver()
{
  if (typoWindowObserver)
    return;

  // Attach our handlers to all browser windows
  typoWindowObserver = new WindowObserver(
  {
    applyToWindow: function(window)
    {
      if (!appIntegration.isKnownWindow(window))
        return;

      netError.applyToWindow(window);
      appIntegration.applyToWindow(window, correctURL);
    },

    removeFromWindow: function(window)
    {
      if (!appIntegration.isKnownWindow(window))
        return;

      netError.removeFromWindow(window);
      appIntegration.removeFromWindow(window);
    }
  });
}
attachWindowObserver();

exports.detachWindowObserver = detachWindowObserver;
function detachWindowObserver()
{
  if (!typoWindowObserver)
    return;

  // Detach our handlers from all browser windows
  typoWindowObserver.shutdown();
  typoWindowObserver = null;
}

function parseURL(url)
{
  if (/^\s*((?:\w+:)?\/*(?:[^\/#]*@)?)([^\/:#]*)/.test(url))
    return [RegExp.$1, RegExp.$2.toLowerCase(), RegExp.rightContext];
  else
    return [url, null, null];
}

function isIPAddress(domain)
{
  try
  {
    Services.eTLD.getBaseDomainFromHost(domain);
    return false;
  }
  catch (e)
  {
    return (e.result == Cr.NS_ERROR_HOST_IS_IP_ADDRESS);
  }
}

function correctURL(window, value)
{
  let hasCorrection = false;

  value = value.trim();
  if (value.length == 0)
    return null;

  // Replace backslashes
  value = value.replace(/\\/g, "/");

  // Does the URL scheme need correcting?
  if (/^([^\/]+)(\/.*)/.test(value))
  {
    let scheme = RegExp.$1;
    let suffix = RegExp.$2;
    let correction = getSchemeCorrection(scheme)
    if (correction != scheme)
    {
      value = correction + suffix;
      hasCorrection = true;
    }
  }

  // Ignore URL schemes that we don't know
  if (/^([\w\-]+:)/.test(value) && !isKnownScheme(RegExp.$1))
    return null;

  // Ignore search keywords and such
  if ("getShortcutOrURI" in window && window.getShortcutOrURI(value) != value)
    return null;

  // Spaces before the first slash or period is probably a quick search
  if (/^[^\/\.\s]+\s/.test(value))
    return null;

  let [prefix, domain, suffix] = parseURL(value);
  if (!domain)
    return null;

  let oldDomain = domain;
  if (!isIPAddress(domain))
  {
    processTypedDomain(domain);

    let newDomain = getDomainCorrection(domain);
    if (newDomain != domain)
    {
      processDomainCorrection(domain, newDomain);
      domain = newDomain;
      hasCorrection = true;

      let referral = getDomainReferral(domain.replace(/^www\./, ""));
      if (referral)
      {
        // We need to add a query string parameter when sending users to this domain
        let anchorIndex = suffix.indexOf("#");
        let anchor = "";
        if (anchorIndex >= 0)
        {
          anchor = suffix.substr(anchorIndex);
          suffix = suffix.substr(0, anchorIndex);
        }

        let queryIndex = suffix.indexOf("?");
        if (queryIndex >= 0)
        {
          if (!/&$/.test(suffix))
            suffix += "&";
          suffix += referral;
        }
        else
        {
          if (suffix.indexOf("/") < 0)
            suffix += "/";
          suffix += "?" + referral;
        }

        suffix += anchor;
      }
    }
  }

  if (!hasCorrection)
    return null;

  if (!appIntegration.isTypoCorrectionEnabled(window, prefix, domain, suffix))
    return null;

  // Show infobar to inform and ask about correction
  let [message, yes, no] = getInfobarTexts();
  message = message.replace(/\?1\?/g, prefix+domain);
  let buttons = [
    {
      label:      yes,
      accessKey:  "",
      callback:   function()
      {
        // Yes: Do nothing
      }
    },
    {
      label:      no,
      accessKey:  "",
      callback:   function()
      {
        // No: Add to list of corrections (ignore)
        let entry = oldDomain.replace(/^www\./, "");
        Prefs.whitelist[entry] = true;
        onWhitelistEntryAdded(entry);
        Prefs.whitelist = JSON.parse(JSON.stringify(Prefs.whitelist));

        appIntegration.loadURI(window, value);
        processFalsePositive(domain, oldDomain);
      }
    }
  ];
  // We need to have persistence being set to 1 due to redirect which happens afterwards
  appIntegration.openInfobar(window, require("info").addonName + "-infobar-askafter", message, buttons, 1);

  require("typoSurvey").incrementCorrectionsCounter();

  return prefix + domain + suffix;
}

let stringBundle = null;

function getInfobarTexts()
{
  // Randomize URI to work around bug 719376
  if (!stringBundle)
    stringBundle = Services.strings.createBundle("chrome://" + require("info").addonName + "/locale/typo.properties?" + Math.random());
  let result = [
    stringBundle.GetStringFromName("urlfixer.isItCorrect"),
    stringBundle.GetStringFromName("urlfixer.yes"),
    stringBundle.GetStringFromName("urlfixer.no")
  ];

  getInfobarTexts = function() result;
  return getInfobarTexts();
}
