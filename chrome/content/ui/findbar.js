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

/**
 * Fake browser implementation to make findbar widget happy - searches in
 * the filter list.
 */
let fastFindBrowser =
{
  fastFind: {
    searchString: null,
    foundLink: null,
    foundEditable: null,
    caseSensitive: false,
    get currentWindow() { return fastFindBrowser.contentWindow; },

    find: function(searchString, linksOnly)
    {
      this.searchString = searchString;
      return treeView.find(this.searchString, 0, false, this.caseSensitive);
    },

    findAgain: function(findBackwards, linksOnly)
    {
      return treeView.find(this.searchString, findBackwards ? -1 : 1, false, this.caseSensitive);
    },

    // Irrelevant for us
    init: function() {},
    setDocShell: function() {},
    setSelectionModeAndRepaint: function() {},
    collapseSelection: function() {}
  },
  currentURI: Utils.makeURI("http://example.com/"),
  contentWindow: {
    focus: function()
    {
      E("list").focus();
    },
    scrollByLines: function(num)
    {
      E("list").boxObject.scrollByLines(num);
    },
    scrollByPages: function(num)
    {
      E("list").boxObject.scrollByPages(num);
    },
  },

  addEventListener: function(event, handler, capture)
  {
    E("list").addEventListener(event, handler, capture);
  },
  removeEventListener: function(event, handler, capture)
  {
    E("list").addEventListener(event, handler, capture);
  },
}
