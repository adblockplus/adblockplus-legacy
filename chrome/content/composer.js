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

let abp = Components.classes["@mozilla.org/adblockplus;1"].createInstance().wrappedJSObject;

let wnd = null;
let item = null;
let advancedMode = false;

function E(id) {
  return document.getElementById(id);
}

function init() {
  // In K-Meleon we might get the arguments wrapped
  for (var i = 0; i < window.arguments.length; i++)
    if (window.arguments[i] && "wrappedJSObject" in window.arguments[i])
      window.arguments[i] = window.arguments[i].wrappedJSObject;

  [wnd, item] = window.arguments;

  E("filterType").value = (!item.filter || item.filter.disabled || item.filter instanceof abp.WhitelistFilter ? "filterlist" : "whitelist");
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

  let ioService = Components.classes["@mozilla.org/network/io-service;1"]
                            .getService(Components.interfaces.nsIIOService);
  try
  {
    let suggestions = [""];

    let url = ioService.newURI(item.location, null, null)
                       .QueryInterface(Components.interfaces.nsIURL);
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

    E("patternGroup").value = (abp.prefs.composer_default in suggestions ? suggestions[abp.prefs.composer_default] : suggestions[1]);
  }
  catch (e)
  {
    // IOService returned nsIURI - not much we can do with it
    addSuggestion(item.location);
    E("patternGroup").value = "";
  }
  if (abp.prefs.composer_default == 0)
    E("customPattern").focus();
  else
    E("patternGroup").focus();

  let types = [];
  for (let type in abp.policy.localizedDescr)
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
    if (type == abp.policy.type.ELEMHIDE)
      continue;

    let typeNode = document.createElement("checkbox");
    typeNode.setAttribute("value", abp.policy.typeDescr[type].toLowerCase());
    typeNode.setAttribute("label", abp.policy.localizedDescr[type].toLowerCase());
    typeNode.setAttribute("checked", "true");
    if (item.type == type)
      typeNode.setAttribute("disabled", "true");
    typeNode.addEventListener("command", updateFilter, false);
    typeGroup.appendChild(typeNode);
  }

  let collapseDefault = E("collapseDefault");
  collapseDefault.label = collapseDefault.getAttribute(abp.prefs.fastcollapse ? "label_no" : "label_yes");
  E("collapse").value = "";
  E("collapse").setAttribute("label", collapseDefault.label);

  updatePatternSelection();

  document.getElementById("disabledWarning").hidden = abp.prefs.enabled;
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
    filter += "|";

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

  filter = abp.normalizeFilter(filter);
  E("regexpWarning").hidden = !abp.Filter.regexpRegExp.test(filter);

  let hasShortcut = true;
  if (E("regexpWarning").hidden)
  {
    let compiledFilter = abp.Filter.fromText(filter);

    let matcher = null;
    if (compiledFilter instanceof abp.BlockingFilter)
      matcher = abp.blacklistMatcher;
    if (compiledFilter instanceof abp.WhitelistFilter)
      matcher = abp.whitelistMatcher;
    if (matcher && !matcher.findShortcut(compiledFilter.text))
      hasShortcut = false;
  }
  E("shortpatternWarning").hidden = hasShortcut;

  E("filter").value = filter;
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

  let startStr = pattern.replace(/\*+$/, '');
  let endStr = pattern.replace(/^\*+/, '');
  disableElement(E("anchorStart"), item.location.substr(0, startStr.length) != startStr, "checked", false);
  disableElement(E("anchorEnd"), item.location.substr(item.location.length - endStr.length, endStr.length) != endStr, "checked", false);

  updateFilter();
  setAdvancedMode(document.documentElement.getAttribute("advancedMode") == "true");
}

function updateCustomPattern()
{
  E("patternGroup").value = "";
  updatePatternSelection();
}

function addFilter() {
  let filter = abp.Filter.fromText(document.getElementById("filter").value);

  if (filter.disabled)
  {
    filter.disabled = false;
    abp.filterStorage.triggerFilterObservers("enable", [filter]);
  }

  abp.filterStorage.addFilter(filter);
  abp.filterStorage.saveToDisk();

  if (wnd && !wnd.closed)
    abp.policy.refilterWindow(wnd);

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
  abp.openSettingsDialog(item.location, E("filter").value);
}

function doEnable() {
  abp.prefs.enabled = true;
  abp.prefs.save();
  E("disabledWarning").hidden = true;
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
