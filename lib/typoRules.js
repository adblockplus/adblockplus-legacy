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
Cu.import("resource://gre/modules/FileUtils.jsm");

let {Prefs} = require("prefs");

let RULES_VERSION = 2;

let CUSTOM_RULE_PRIORITY = 0x7FFFFFFF;

let rules = {expressions: []};

loadRules();

// Make first attempt to update rules after five minutes
let updateTimer = null;
updateTimer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
updateTimer.initWithCallback(onTimer, 1000 * 60 * 5, Ci.nsITimer.TYPE_REPEATING_SLACK);
onShutdown.add(function() updateTimer.cancel());

function loadRules()
{
  loadRulesFrom(Services.io.newFileURI(getRuleFile()).spec, false, function(success)
  {
    if (!success)
      loadRulesFrom(require("info").addonRoot + "defaults/typoRules.json", true);
  });
}

function loadRulesFrom(url, ignoreVersion, callback)
{
  if (typeof callback != "function")
    callback = function() {};

  let request = Cc["@mozilla.org/xmlextras/xmlhttprequest;1"].createInstance(Ci.nsIXMLHttpRequest);
  request.open("GET", url);
  request.overrideMimeType("text/plain");
  request.addEventListener("load", function()
  {
    try
    {
      // Remove comments from the file if any
      let data = JSON.parse(request.responseText.replace(/^\s*\/\/.*/mg, ""));
      if (ignoreVersion || data.version == RULES_VERSION)
      {
        rules = data;
        callback(true);

        // Add user-defined rules after calling the callback - if the callback
        // saves the rules then the custom rules won't be included.
        addCustomRules();
      }
      else
        callback(false);
    }
    catch (e)
    {
      Cu.reportError(e);
      callback(false);
    }
  }, false);
  request.addEventListener("error", function()
  {
    callback(false);
  }, false);

  try
  {
    request.send(null);
  }
  catch (e)
  {
    if (e.result != Cr.NS_ERROR_FILE_NOT_FOUND)
      Cu.reportError(e);
    callback(false);
  }
}

function getRuleFile()
{
  let result = FileUtils.getFile("ProfD", [require("info").addonName + "-rules.json"]);

  getRuleFile = function() result;
  return getRuleFile();
}

function addCustomRules()
{
  for (let domain in Prefs.whitelist)
    onWhitelistEntryAdded(domain);
}

function onWhitelistEntryAdded(domain)
{
  let reverse = domain.split("").reverse().join("");
  addSuffix(rules.domain, reverse, CUSTOM_RULE_PRIORITY);
}
exports.onWhitelistEntryAdded = onWhitelistEntryAdded;

function onWhitelistEntryRemoved(domain)
{
  let reverse = domain.split("").reverse().join("");
  removeSuffix(rules.domain, reverse, CUSTOM_RULE_PRIORITY);
}
exports.onWhitelistEntryRemoved = onWhitelistEntryRemoved;

function addSuffix(tree, suffix, priority)
{
  if (suffix.length == 0)
  {
    // We are at the last character, just put our priority here
    tree[""] = " " + priority;
    return;
  }

  let c = suffix[0];
  if (c in tree)
  {
    let existing = tree[c];
    if (typeof existing == "string")
    {
      // Single choice for this suffix, maybe the same entry?
      if (existing.substr(0, suffix.length - 1) == suffix.substr(1) && existing[suffix.length - 1] == " ")
      {
        // Same entry, simply replace it by new priority
        tree[c] = suffix.substr(1) + " " + priority;
      }
      else
      {
        // Different entry, need to add a new branching point and go deeper
        if (existing[0] == " ")
          tree[c] = {"": existing};
        else
        {
          tree[c] = {};
          tree[c][existing[0]] = existing.substr(1);
        }
        addSuffix(tree[c], suffix.substr(1), priority);
      }
    }
    else
    {
      // Multiple choices for this suffix - go deeper
      addSuffix(existing, suffix.substr(1), priority);
    }
  }
  else
  {
    // No existing entry yet, just add ours
    tree[c] = suffix.substr(1) + " " + priority;
  }
}

function removeSuffix(tree, suffix, priority)
{
  if (suffix.length == 0)
  {
    // We are at the last character, check whether there is an entry with
    // matching priority
    if ("" in tree && tree[""] == " " + priority)
      delete tree[""];
    return;
  }

  let c = suffix[0];
  if (!(c in tree))
    return;

  if (typeof tree[c] == "string")
  {
    // Single entry - check whether it is the right one
    if (tree[c] == suffix.substr(1) + " " + priority)
      delete tree[c];
  }
  else
  {
    // Multiple entries, need to go deeper
    removeSuffix(tree[c], suffix.substr(1), priority);
  }
}

function onTimer()
{
  // Next check in 1 hour
  updateTimer.delay = 1000 * 60 * 60;

  // Only download rules every three days
  let nextUpdate = Prefs.lastRuleUpdate + 60 * 60 * 24 * 3;
  if (nextUpdate > Date.now() / 1000)
    return;

  loadRulesFrom("http://urlfixer.org/download/rules.json?version=" + RULES_VERSION, false, function(success)
  {
    if (success)
    {
      rules.timestamp = Date.now();

      try
      {
        // Save the rules to file.
        let rulesText = JSON.stringify(rules);
        let fileStream = FileUtils.openSafeFileOutputStream(getRuleFile());
        let stream = Cc["@mozilla.org/intl/converter-output-stream;1"].createInstance(Ci.nsIConverterOutputStream);
        stream.init(fileStream, "UTF-8", 16384, Ci.nsIConverterInputStream.DEFAULT_REPLACEMENT_CHARACTER);
        stream.writeString(rulesText);
        stream.flush();
        FileUtils.closeSafeFileOutputStream(fileStream);
      }
      catch(e)
      {
        Cu.reportError(e);
      }
    }
  });

  Prefs.lastRuleUpdate = Date.now() / 1000;
}

exports.getSchemeCorrection = getSchemeCorrection;
function getSchemeCorrection(scheme)
{
  return getBestMatch(scheme, rules.scheme, 1, null);
}

exports.isKnownScheme = isKnownScheme;
function isKnownScheme(scheme)
{
  return (getSimilarStrings(scheme, rules.scheme, 0, null).length > 0);
}

exports.getDomainCorrection = getDomainCorrection;
function getDomainCorrection(domain)
{
  // Apply user's custom changes first
  let customRules = Prefs.custom_replace;
  for (let searchString in customRules)
  {
    let replacement = customRules[searchString];
    searchString = searchString.toLowerCase();
    if (/^re:+/.test(searchString))
      domain = domain.replace(new RegExp(RegExp.rightContext, "g"), replacement);
    else
      domain = domain.replace(searchString, replacement);
  }

  // Now apply our rules on the domain name
  for (let i = 0, l = rules.expressions.length; i < l; i++)
    domain = applyExpression(domain, rules.expressions[i]);

  // Find similar known domains, test domains without the www. prefix
  if (domain.substr(0, 4) == "www.")
    domain = "www." + getBestMatch(domain.substr(4), rules.domain, 1, ".");
  else
    domain = getBestMatch(domain, rules.domain, 1, ".");

  return domain;
}

exports.getDomainReferral = getDomainReferral;
function getDomainReferral(domain)
{
  if ("domainReferrals" in rules && domain in rules.domainReferrals)
    return rules.domainReferrals[domain];
  else
    return null;
}

function applyExpression(string, expression)
{
  if (expression.nomatch && new RegExp(expression.nomatch).test(string))
    return string;

  return string.replace(new RegExp(expression.find, "g"), expression.replace);
}

function getSimilarStrings(input, dictionary, maxDistance, separator)
{
  // We use a non-deterministic final automaton to perform a search on all
  // strings in the dictionary simultaneously (see
  // http://blog.notdot.net/2010/07/Damn-Cool-Algorithms-Levenshtein-Automata
  // for the basic algorithm). However, we use Damerau-Levenshtein distance
  // (transposition of two adjacent letters counts as one operation), meaning
  // one additional transition for the automaton. The number of automaton states
  // can theoretically be extremely large, the maxDistance parameter limits the
  // number of states we need to process however. We process the input string
  // backwards to allow matching domain names for a longer host name.

  let results = [];

  function processState(entry, distance, position, result)
  {
    let isString = (typeof entry == "string");

    // Do we have a result?
    if (position < 0 || input[position] == separator)
    {
      if (!isString && "" in entry)
        results.push([result, input.substr(position + 1), distance, parseInt(entry[""], 10)]);
      else if (isString && entry[0] == " ")
        results.push([result, input.substr(position + 1), distance, parseInt(entry, 10)]);
    }

    // Maybe there is a match
    if (position >= 0)
    {
      let nextChar = input[position];
      if (!isString && nextChar in entry)
        processState(entry[nextChar], distance, position - 1, nextChar + result);
      else if (isString && entry[0] == nextChar)
        processState(entry.substr(1), distance, position - 1, nextChar + result);
    }

    // Mistakes
    if (distance < maxDistance)
    {
      // Deletion and substitution
      if (!isString)
      {
        for (let c in entry)
        {
          if (c != "")
            processState(entry[c], distance + 1, position, c + result);
          if (c != "" && position >= 0)
            processState(entry[c], distance + 1, position - 1, c + result);
        }
      }
      else if (entry[0] != " ")
      {
        processState(entry.substr(1), distance + 1, position, entry[0] + result);
        if (position >= 0)
          processState(entry.substr(1), distance + 1, position - 1, entry[0] + result);
      }

      // Insertion
      if (position >= 0)
        processState(entry, distance + 1, position - 1, result);

      // Transposition
      if (position >= 1)
      {
        let nextChar1 = input[position];
        let nextChar2 = input[position - 1];
        if (isString)
        {
          if (entry[0] == nextChar2 && entry[1] == nextChar1)
            processState(entry.substr(2), distance + 1, position - 2, nextChar1 + nextChar2 + result);
        }
        else if (nextChar2 in entry)
        {
          let nextEntry = entry[nextChar2];
          if (typeof nextEntry != "string")
          {
            if (nextChar1 in nextEntry)
              processState(nextEntry[nextChar1], distance + 1, position - 2, nextChar1 + nextChar2 + result);
          }
          else
          {
            if (nextEntry[0] == nextChar1)
              processState(nextEntry.substr(1), distance + 1, position - 2, nextChar1 + nextChar2 + result);
          }
        }
      }
    }
  }

  processState(dictionary, 0, input.length - 1, "");
  return results;
}

function getBestMatch(input, dictionary, maxDistance, separator)
{
  let suggestions = getSimilarStrings(input, dictionary, maxDistance, separator);

  let bestSuggestion = null;
  let bestSuggestionDistance;
  let bestSuggestionMatched;
  let bestSuggestionPriority;
  for (let i = 0; i < suggestions.length; i++)
  {
    let [suggestion, matchedString, distance, priority] = suggestions[i];
    if (suggestion == input)
      return suggestion;

    let matchedLen = matchedString.length;
    if (priority < 0 && matchedLen == input.length)
    {
      // TLDs should never be proposed as a replacement for the entire host name
      continue;
    }

    if (!bestSuggestion ||
        bestSuggestionMatched < matchedLen ||
        (bestSuggestionMatched == matchedLen && bestSuggestionDistance > distance) ||
        (bestSuggestionMatched == matchedLen && bestSuggestionDistance == distance && bestSuggestionPriority < priority))
    {
      bestSuggestion = suggestion;
      bestSuggestionDistance = distance;
      bestSuggestionMatched = matchedLen;
      bestSuggestionPriority = priority;
    }
  }
  if (bestSuggestion)
    return input.substr(0, input.length - bestSuggestionMatched) + bestSuggestion;
  else
    return input;
}
