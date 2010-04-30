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

let wnd = null;
let item = null;
let advancedMode = false;

function init() {
  // In K-Meleon we might get the arguments wrapped
  for (var i = 0; i < window.arguments.length; i++)
    if (window.arguments[i] && "wrappedJSObject" in window.arguments[i])
      window.arguments[i] = window.arguments[i].wrappedJSObject;

  [wnd, item] = window.arguments;

  E("filterType").value = (!item.filter || item.filter.disabled || item.filter instanceof WhitelistFilter ? "filterlist" : "whitelist");
  E("customPattern").value = item.location;

  let insertionPoint = E("customPatternBox");
  let addSuggestion = function(address)
  {
    let suggestion = document.createElement("radio");
    suggestion.setAttribute("value", address);
    suggestion.setAttribute("label", address);
    suggestion.setAttribute("crop", "center");
    insertionPoint.parentNode.insertBefore(suggestion, insertionPoint);
  }

  let ioService = Cc["@mozilla.org/network/io-service;1"].getService(Ci.nsIIOService);
  try
  {
    let suggestions = [""];

    let url = ioService.newURI(item.location, null, null)
                       .QueryInterface(Ci.nsIURL);
    let suffix = (url.query ? "?*" : "");
    url.query = "";
    suggestions[1] = url.spec + suffix;
    addSuggestion(suggestions[1]);

    let parentURL = ioService.newURI(url.fileName == "" ? ".." : ".", null, url);
    if (!parentURL.equals(url))
    {
      suggestions[2] = parentURL.spec + "*";
      addSuggestion(suggestions[2]);
    }
    else
      suggestions[2] = suggestions[1];

    let rootURL = ioService.newURI("/", null, url);
    if (!rootURL.equals(parentURL) && !rootURL.equals(url))
    {
      suggestions[3] = rootURL.spec + "*";
      addSuggestion(suggestions[3]);
    }
    else
      suggestions[3] = suggestions[2];

    try
    {
      suggestions[4] = url.host.replace(/^www\./, "") + "^";
      addSuggestion(suggestions[4]);
    }
    catch (e)
    {
      suggestions[4] = suggestions[3];
    }

    try
    {
      let effectiveTLD = Cc["@mozilla.org/network/effective-tld-service;1"].getService(Ci.nsIEffectiveTLDService);
      suggestions[5] = effectiveTLD.getBaseDomainFromHost(url.host) + "^";
      if (suggestions[5] != suggestions[4])
        addSuggestion(suggestions[5]);
    }
    catch (e)
    {
      suggestions[5] = suggestions[5];
    }

    E("patternGroup").value = (Prefs.composer_default in suggestions ? suggestions[Prefs.composer_default] : suggestions[1]);
  }
  catch (e)
  {
    // IOService returned nsIURI - not much we can do with it
    addSuggestion(item.location);
    E("patternGroup").value = "";
  }
  if (Prefs.composer_default == 0)
    E("customPattern").focus();
  else
    E("patternGroup").focus();

  let types = [];
  for (let type in Policy.localizedDescr)
  {
    types.push(parseInt(type));
  }
  types.sort(function(a, b) {
    if (a < b)
      return -1;
    else if (a > b)
      return 1;
    else
      return 0;
  });

  let docDomain = item.docDomain;
  let thirdParty = item.thirdParty;

  if (docDomain)
    docDomain = docDomain.replace(/^www\./i, "").replace(/\.+$/, "");
  if (docDomain)
    E("domainRestriction").value = docDomain;

  E("thirdParty").hidden = !thirdParty;
  E("firstParty").hidden = thirdParty;

  let typeGroup = E("typeGroup");
  for each (let type in types)
  {
    if (type == Policy.type.ELEMHIDE)
      continue;

    let typeNode = document.createElement("checkbox");
    typeNode.setAttribute("value", Policy.typeDescr[type].toLowerCase());
    typeNode.setAttribute("label", Policy.localizedDescr[type].toLowerCase());
    typeNode.setAttribute("checked", "true");
    if (item.type == type)
      typeNode.setAttribute("disabled", "true");
    typeNode.addEventListener("command", updateFilter, false);
    typeGroup.appendChild(typeNode);
  }

  let collapseDefault = E("collapseDefault");
  collapseDefault.label = collapseDefault.getAttribute(Prefs.fastcollapse ? "label_no" : "label_yes");
  E("collapse").value = "";
  E("collapse").setAttribute("label", collapseDefault.label);

  let warning = E("disabledWarning");
  generateLinkText(warning);
  warning.hidden = Prefs.enabled;

  updatePatternSelection();
}

function updateFilter()
{
  let filter = "";

  let type = E("filterType").value
  if (type == "whitelist")
    filter += "@@";

  let pattern = E("patternGroup").value;
  if (pattern == "")
    pattern = E("customPattern").value;

  if (E("anchorStart").checked)
    filter += E("anchorStart").flexibleAnchor ? "||" : "|";

  filter += pattern;

  if (E("anchorEnd").checked)
    filter += "|";

  if (advancedMode)
  {
    let options = [];

    if (E("domainRestrictionEnabled").checked)
    {
      let domainRestriction = E("domainRestriction").value.replace(/[,\s]/g, "").replace(/\.+$/, "");
      if (domainRestriction)
        options.push("domain=" + domainRestriction);
    }

    if (E("firstParty").checked)
      options.push("~third-party");
    if (E("thirdParty").checked)
      options.push("third-party");

    if (E("matchCase").checked)
      options.push("match-case");

    let collapse = E("collapse");
    disableElement(collapse, type == "whitelist", "value", "");
    if (collapse.value != "")
      options.push(collapse.value);

    let enabledTypes = [];
    let disabledTypes = [];
    for (let typeNode = E("typeGroup").firstChild; typeNode; typeNode = typeNode.nextSibling)
    {
      let value = typeNode.getAttribute("value");
      if (value == "document")
        disableElement(typeNode, type != "whitelist", "checked", false);

      if (value != "document" || !typeNode.disabled)
      {
        if (typeNode.checked)
          enabledTypes.push(value);
        else
          disabledTypes.push("~" + value);
      }
    }
    if (disabledTypes.length < enabledTypes.length)
      options.push.apply(options, disabledTypes);
    else
      options.push.apply(options, enabledTypes);

    if (options.length)
      filter += "$" + options.join(",");
  }

  filter = Filter.normalize(filter);
  E("regexpWarning").hidden = !Filter.regexpRegExp.test(filter);

  let hasShortcut = true;
  let compiledFilter = Filter.fromText(filter);
  if (E("regexpWarning").hidden)
  {
    let matcher = null;
    if (compiledFilter instanceof BlockingFilter)
      matcher = blacklistMatcher;
    if (compiledFilter instanceof WhitelistFilter)
      matcher = whitelistMatcher;
    if (matcher && !matcher.findShortcut(compiledFilter.text))
      hasShortcut = false;
  }
  E("shortpatternWarning").hidden = hasShortcut;

  E("filter").value = filter;

  if (E("disabledWarning").hidden)
  {
    let subscription = null;
    for each (let s in FilterStorage.subscriptions)
      if (s instanceof SpecialSubscription && s.isFilterAllowed(compiledFilter) && (!subscription || s.priority > subscription.priority))
        subscription = s;

    let warning = E("groupDisabledWarning");
    if (subscription && subscription.disabled)
    {
      warning.subscription = subscription;
      generateLinkText(warning, subscription.title);
      warning.hidden = false;
    }
    else
      warning.hidden = true;
  }
  else
    E("groupDisabledWarning").hidden = true;
}

function generateLinkText(element, replacement)
{
  let template = element.getAttribute("textTemplate");
  if (typeof replacement != "undefined")
    template = template.replace(/\?1\?/g, replacement)

  let beforeLink, linkText, afterLink;
  if (/(.*)\[link\](.*)\[\/link\](.*)/.test(template))
    [beforeLink, linkText, afterLink] = [RegExp.$1, RegExp.$2, RegExp.$3];
  else
    [beforeLink, linkText, afterLink] = ["", template, ""];

  while (element.firstChild && element.firstChild.nodeType != Node.ELEMENT_NODE)
    element.removeChild(element.firstChild);
  while (element.lastChild && element.lastChild.nodeType != Node.ELEMENT_NODE)
    element.removeChild(element.lastChild);
  if (!element.firstChild)
    return;

  element.firstChild.textContent = linkText;
  element.insertBefore(document.createTextNode(beforeLink), element.firstChild);
  element.appendChild(document.createTextNode(afterLink));
}

function updatePatternSelection()
{
  let pattern = E("patternGroup").value;
  if (pattern == "")
  {
    pattern = E("customPattern").value;
  }
  else
  {
    E("anchorStart").checked = true;
    E("anchorEnd").checked = false;
  }

  function testFilter(/**String*/ filter) /**Boolean*/
  {
    return RegExpFilter.fromText(filter).matches(item.location, item.typeDescr, item.docDomain, item.thirdParty);
  }

  let anchorStartCheckbox = E("anchorStart");
  if (!/^\*/.test(pattern) && testFilter("||" + pattern))
  {
    disableElement(anchorStartCheckbox, false, "checked", false);
    anchorStartCheckbox.setAttribute("label", anchorStartCheckbox.getAttribute("labelFlexible"));
    anchorStartCheckbox.accessKey =  anchorStartCheckbox.getAttribute("accesskeyFlexible");
    anchorStartCheckbox.flexibleAnchor = true;
  }
  else
  {
    disableElement(anchorStartCheckbox, /^\*/.test(pattern) || !testFilter("|" + pattern), "checked", false);
    anchorStartCheckbox.setAttribute("label", anchorStartCheckbox.getAttribute("labelRegular"));
    anchorStartCheckbox.accessKey = anchorStartCheckbox.getAttribute("accesskeyRegular");
    anchorStartCheckbox.flexibleAnchor = false;
  }
  disableElement(E("anchorEnd"), /[\*\^]$/.test(pattern) || !testFilter(pattern + "|"), "checked", false);

  updateFilter();
  setAdvancedMode(document.documentElement.getAttribute("advancedMode") == "true");
}

function updateCustomPattern()
{
  E("patternGroup").value = "";
  updatePatternSelection();
}

function addFilter() {
  let filter = Filter.fromText(document.getElementById("filter").value);

  if (filter.disabled)
  {
    filter.disabled = false;
    FilterStorage.triggerFilterObservers("enable", [filter]);
  }

  FilterStorage.addFilter(filter);
  FilterStorage.saveToDisk();

  if (wnd && !wnd.closed)
    Policy.refilterWindow(wnd);

  return true;
}

function setAdvancedMode(mode) {
  advancedMode = mode;

  var dialog = document.documentElement;
  dialog.setAttribute("advancedMode", advancedMode);

  var button = dialog.getButton("disclosure");
  button.setAttribute("label", dialog.getAttribute(advancedMode ? "buttonlabeldisclosure_off" : "buttonlabeldisclosure_on"));

  updateFilter();
}

function disableElement(element, disable, valueProperty, disabledValue) {
  if (element.disabled == disable)
    return;

  element.disabled = disable;
  if (disable)
  {
    element._abpStoredValue = element[valueProperty];
    element[valueProperty] = disabledValue;
  }
  else
  {
    if ("_abpStoredValue" in element)
      element[valueProperty] = element._abpStoredValue;
    delete element._abpStoredValue;
  }
}

function openPreferences() {
  Utils.openSettingsDialog(item.location, E("filter").value);
}

function doEnable() {
  Prefs.enabled = true;
  Prefs.save();
  E("disabledWarning").hidden = true;
}

function enableSubscription(subscription)
{
  subscription.disabled = false;
  FilterStorage.triggerSubscriptionObservers("enable", [subscription]);
  FilterStorage.saveToDisk();
  E("groupDisabledWarning").hidden = true;
}

/**
 * Selects or unselects all type checkboxes except those
 * that are disabled.
 */
function selectAllTypes(/**Boolean*/ select)
{
  for (let typeNode = E("typeGroup").firstChild; typeNode; typeNode = typeNode.nextSibling)
    if (typeNode.getAttribute("disabled") != "true")
      typeNode.checked = select;
  updateFilter();
}
