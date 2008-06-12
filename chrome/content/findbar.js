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

var findBar = null;
var findComposing = false;
var lastSearch = null;
var prevSearchLength = 0;
var findBarTimeout = null;
var sound = null;
var typeAheadSoundURL = null;

var useTypeAheadFind = false;
var useTypeAheadTimeout = 5000;
var useTypeAheadSound = null;
try {
  var prefService = Components.classes["@mozilla.org/preferences-service;1"]
                              .getService(Components.interfaces.nsIPrefBranch);
  useTypeAheadFind = prefService.getBoolPref("accessibility.typeaheadfind");
  useTypeAheadTimeout = prefService.getIntPref("accessibility.typeaheadfind.timeout");
  useTypeAheadSound = prefService.getCharPref("accessibility.typeaheadfind.soundURL");
} catch(e) {}

function openFindBar(typeAheadStr) {
  if (typeof typeAheadStr == "undefined")
    typeAheadStr = "";

  findBar = document.getElementById("FindToolbar");

  if (findBar.hidden) {
    findBar.hidden = false;
    setFindBarStatus(null);
  }
  else if (typeAheadStr)
    return;

  var field = document.getElementById("find-field");
  field.select();
  field.focus();

  if (typeAheadStr) {
    field.value = typeAheadStr;
    field.setSelectionRange(typeAheadStr.length, typeAheadStr.length);
    find(typeAheadStr);
    resetFindBarTimeout();
  }
}

function closeFindBar() {
  if (findComposing)
    return;

  var focused = false;
  for (var element = document.commandDispatcher.focusedElement; element; element = element.parentNode)
    if (element == findBar)
      focused = true;

  if (focused)
    document.getElementById("list").focus();
  treeView.ensureSelection(0);
  findBar.hidden = true;

  if (findBarTimeout) {
    window.clearTimeout(findBarTimeout);
    findBarTimeout = null;
  }
}

function onFindBarBlur() {
  if (findBarTimeout)
    closeFindBar();
}

function onFindBarKeyPress(e) {
  if (e.keyCode == e.DOM_VK_RETURN || e.keyCode == e.DOM_VK_ENTER) {
    if (e.ctrlKey)
      document.getElementById("highlight").checked = true;

    doFind(e.shiftKey ? -1 : 1);
    e.preventDefault();
    e.stopPropagation();
  }
  else if (e.keyCode == e.DOM_VK_ESCAPE) {
    closeFindBar();
    e.preventDefault();
    e.stopPropagation();
  }
  else if (e.keyCode == e.DOM_VK_UP || e.keyCode == e.DOM_VK_DOWN ||
           e.keyCode == e.DOM_VK_PAGE_UP || e.keyCode == e.DOM_VK_DOWN) {
    var newEvent = document.createEvent("KeyEvents");
    newEvent.initKeyEvent("keypress", true, true, window.document.defaultView,
                          e.ctrlKey, e.altKey, e.shiftKey, e.metaKey, e.keyCode, e.charCode);
    document.getElementById("list").dispatchEvent(newEvent);
    e.preventDefault();
    e.stopPropagation();
  }
}

function onFindBarCompositionStart() {
  findComposing = true;
}

function onFindBarCompositionEnd() {
  findComposing = false;
}

function setFindBarStatus(status) {
  if (status) {
    var statusCode = (status == "NotFound" ? "notfound" : "wrapped");
    document.getElementById("find-field").setAttribute("status", statusCode);
    document.getElementById("find-status-icon").setAttribute("status", statusCode);
    document.getElementById("find-status").setAttribute("value", abp.getString(status));
  }
  else {
    document.getElementById("find-field").removeAttribute("status");
    document.getElementById("find-status-icon").removeAttribute("status");
    document.getElementById("find-status").removeAttribute("value");
  }
}

function playNotFoundSound() {
  if (!useTypeAheadSound)
    return;

  if (!sound) {
    sound = Components.classes["@mozilla.org/sound;1"]
                          .createInstance(Components.interfaces.nsISound);

    if (useTypeAheadSound == "default")
      useTypeAheadSound = "chrome://global/content/notfound.wav";

    if (useTypeAheadSound != "beep") {
      try {
        typeAheadSoundURL = Components.classes["@mozilla.org/network/standard-url;1"]
                                      .createInstance(Components.interfaces.nsIURL);
        typeAheadSoundURL.spec = useTypeAheadSound;
      } catch(e) {}
    }
  }

  try {
    if (useTypeAheadSound == "beep")
      sound.beep();
    else
      sound.play(typeAheadSoundURL);
  } catch(e) {}
}

function doFind(direction) {
  if (findBarTimeout)
    resetFindBarTimeout();

  var playSound = (lastSearch && lastSearch.length > prevSearchLength);
  prevSearchLength = (lastSearch ? lastSearch.length : 0);

  document.getElementById("find-previous").setAttribute("disabled", !lastSearch);
  document.getElementById("find-next").setAttribute("disabled", !lastSearch);

  if (!lastSearch) {
    setFindBarStatus(null);
    return;
  }

  var status = treeView.find(lastSearch, direction, document.getElementById("highlight").checked);
  setFindBarStatus(status);

  if (status == "NotFound" && playSound)
    playNotFoundSound();
}

function find(text) {
  lastSearch = text;
  doFind(0);
}

function findAgain() {
  doFind(1);
}

function findPrevious() {
  doFind(-1);
}

function toggleHighlight() {
  setTimeout(function() {doFind(0)}, 0);
}

function resetFindBarTimeout() {
  if (findBarTimeout)
    window.clearTimeout(findBarTimeout);

  findBarTimeout = window.setTimeout(closeFindBar, useTypeAheadTimeout);
}
