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

// Retrieves a method but ignores any redefined properties, uses only XPCOM interfaces instead
// Usage: secureLookup(object, "property1", "property2", ..., "method")
// This is a secure version of object.property1.property2.method
function secureLookup() {
  try {
    var lookupFunc = ('utils' in Components ? Components.utils.lookupMethod : Components.lookupMethod);
    var obj = arguments[0];
    for (var i = 1; i < arguments.length; i++) {
      var method = lookupFunc(obj, arguments[i]);
      if (i == arguments.length - 1)
        return method;
      else if (method.arity == 0)
        obj = method();
      else
        return null;
    }
  } catch(e) {}

  return null;
}

// Retrieves the value of a property but ignores any redefined properties
// Usage: secureGet(object, "property1", "property2", ...)
// This is a secure version of object.property1.property2
function secureGet() {
  var method = secureLookup.apply(null, arguments);
  try {
    return (method && method.arity == 0 ? method() : null);
  }
  catch (e) {
    return null;
  }
}

// Sets the value of a property but ignores any redefined properties
// Usage: secureSet(object, "property1", "property2", ..., value)
// This is a secure version of object.property1.property2 = value
function secureSet() {
  var value = arguments[arguments.length - 1];
  arguments.length--;

  var method = secureLookup.apply(null, arguments);
  if (method && method.arity == 0)
    method(value);
}

