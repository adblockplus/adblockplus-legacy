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
 * Portions created by the Initial Developer are Copyright (C) 2006
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *
 * ***** END LICENSE BLOCK ***** */

/*
 * Content policy implementation, responsible for blocking things.
 * This file is included from nsAdblockPlus.js.
 */

var type, typeDescr, localizedDescr, blockTypes, blockSchemes, linkTypes, linkSchemes, baseTypes, baseNames;

const ok = ("ACCEPT" in Components.interfaces.nsIContentPolicy ? Components.interfaces.nsIContentPolicy.ACCEPT : true);
const block = ("REJECT_REQUEST" in Components.interfaces.nsIContentPolicy ? Components.interfaces.nsIContentPolicy.REJECT_REQUEST : false);
const oldStyleAPI = (typeof ok == "boolean");

var policy = {
  init: function() {
    var types = ["OTHER", "SCRIPT", "IMAGE", "STYLESHEET", "OBJECT", "SUBDOCUMENT", "DOCUMENT"];
  
    // type constant by type description and type description by type constant
    type = {};
    typeDescr = {};
    localizedDescr = {};
    var iface = Components.interfaces.nsIContentPolicy;
    for (var k = 0; k < types.length; k++) {
      var typeName = types[k];
      type[typeName] = typeName in iface ? iface[typeName] : iface["TYPE_" + typeName];
      typeDescr[type[typeName]] = typeName;
      localizedDescr[type[typeName]] = abp.getString("type_label_" + typeName.toLowerCase());
    }
  
    type.LINK = 0xFFFF;
    typeDescr[0xFFFF] = "LINK";
    localizedDescr[0xFFFF] = abp.getString("type_label_link");
  
    type.BACKGROUND = 0xFFFE;
    typeDescr[0xFFFE] = "BACKGROUND";
    localizedDescr[0xFFFE] = abp.getString("type_label_background");
  
    // blockable content-policy types
    blockTypes = {
      SCRIPT: true,
      STYLESHEET: true,
      IMAGE: true,
      OBJECT: true,
      SUBDOCUMENT: true
    };
    this.translateTypes(blockTypes);
  
    // blockable schemes
    blockSchemes = {http: true, https: true};
  
    // link-searchable types + href-protocols
    linkTypes = {
      IMAGE: true,
      OBJECT: true
    };
    this.translateTypes(linkTypes);
  
    linkSchemes = {http: true, https: true, javascript: true};
  
    // unalterable content-policy types + nodeNames -- root-elements
    baseTypes = {
      SCRIPT: true,
      STYLESHEET: true
    };
    this.translateTypes(baseTypes);
  
    baseNames = {html: true, body: true, script: true};
  },

  // Checks whether a node should be blocked, hides it if necessary, return value false means that the node is blocked
  processNode: function(insecNode, contentType, location, collapse) {
    var insecWnd = getTopWindow(insecNode);
    if (!insecWnd || (!prefs.blocklocalpages && !this.isBlockableScheme(secureGet(insecWnd, "location"))))
      return true;

    if (this.isWhitelisted(secureGet(insecWnd, "location", "href")))
      return true;

    var data = DataContainer.getDataForWindow(insecWnd);
    if (!collapse)
      insecNode = elementInterface(contentType, insecNode);

    var match = null;
    var linksOk = true;
    if (prefs.enabled) {
      // Try to use previous results - if there were any
      match = cache.get(location);

      if (typeof match == "undefined") {
        // If we didn't cache the result yet:
        // check whether we want to block the node and store the result
        match = matchesAny(location, prefs.whitelist);

        if (match == null)
          match = matchesAny(location, prefs.regexps);

        cache.put(location, match);
      }

      // Check links in parent nodes
      if (insecNode && prefs.linkcheck && contentType in linkTypes)
        linksOk = this.checkLinks(insecNode);

      // If the node wasn't blocked we still might want to add a frame to it
      if (!match && prefs.frameobjects
          && (contentType == type.OBJECT || secureGet(insecNode, "nodeName").toLowerCase() == "embed") // objects and raw-embeds
          && location != secureGet(insecNode, "ownerDocument", "defaultView", "location", "href")) // it's not a standalone object
        secureLookup(insecWnd, "setTimeout")(addObjectTab, 0, insecNode, location, insecWnd);
    }

    // Fix type for background images
    if (contentType == type.IMAGE && secureGet(insecNode, "nodeType") == Node.DOCUMENT_NODE)
      contentType = type.BACKGROUND;

    // Store node data
    data.addNode(insecNode, contentType, location, match);

    if (match && !match.isWhite && insecNode) {
      // hide immediately if fastcollapse is off but not base types
      collapse = collapse || !prefs.fastcollapse;
      collapse = collapse && !(contentType in baseTypes || secureGet(insecNode, "nodeName").toLowerCase() in baseNames);
      hideNode(insecNode, insecWnd, collapse);
    }

    return (match && match.isWhite) || (!match && linksOk);
  },

  // Tests if some parent of the node is a link matching a filter
  checkLinks: function(insecNode) {
    while (insecNode && (secureGet(insecNode, "href") == null || !this.isBlockableScheme(insecNode)))
      insecNode = secureGet(insecNode, "parentNode");
  
    if (insecNode)
      return this.processNode(insecNode, type.LINK, secureGet(insecNode, "href"), false);
    else
      return true;
  },

  // Checks whether the location object's scheme is blockable
  isBlockableScheme: function(insecLoc) {
    var protocol = secureGet(insecLoc, "protocol");
    return (protocol && protocol.replace(/\W/,"").toLowerCase() in blockSchemes);
  },

  // Checks whether a page is whitelisted
  isWhitelisted: function(url) {
    return matchesAny(url, prefs.whitelist);
  },

  translateTypes: function(hash) {
    for (var key in hash)
      if (!key.match(/[^A-Z]/) && key in type)
        hash[type[key]] = hash[key];
  },

  // nsIContentPolicy interface implementation
  shouldLoad: function(contentType, contentLocation, requestOrigin, insecRequestingNode, mimeTypeGuess, extra) {
    // if it's not a blockable type or not the HTTP protocol, use the usual policy
    if (!(contentType in blockTypes && contentLocation.scheme in blockSchemes))
      return ok;

    // handle old api
    if (oldStyleAPI)
      insecRequestingNode = requestOrigin;  // oldStyleAPI @params: function(contentType, contentLocation, context, wnd)

    if (!insecRequestingNode)
      return ok;

    return (this.processNode(insecRequestingNode, contentType, contentLocation.spec, false) ? ok : block);
  },

  shouldProcess: function(contentType, contentLocation, requestOrigin, insecRequestingNode, mimeType, extra) {
    return ok;
  }
};

policy.init();
abp.policy = policy;

// Tests if a given URL matches any of the regexps from the list, returns the matching pattern
function matchesAny(location, list) {
  for (var i = 0; i < list.length; i++)
    if (list[i].test(location))
      return list[i];

  return null; // if no matches, return null
}
