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
 * Portions created by the Initial Developer are Copyright (C) 2006-2007
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *
 * ***** END LICENSE BLOCK ***** */

#include "adblockplus.h"

nsCOMPtr<abpScriptable> scriptable = new abpScriptable();

NS_IMPL_ISUPPORTS1(abpScriptable, nsIXPCScriptable)

/***********************************
 * nsIXPCScriptable implementation *
 ***********************************/

 NS_METHOD abpScriptable::GetClassName(char** retval) {
  NS_ENSURE_ARG_POINTER(retval);

  *retval = "abpScriptable";

  return NS_OK;
}

NS_METHOD abpScriptable::GetScriptableFlags(PRUint32* retval) {
  NS_ENSURE_ARG_POINTER(retval);

  *retval = nsIXPCScriptable::WANT_GETPROPERTY | nsIXPCScriptable::WANT_NEWRESOLVE;

  return NS_OK;
}

NS_METHOD abpScriptable::GetProperty(nsIXPConnectWrappedNative* wrapper, JSContext* cx, JSObject* obj, jsval id, jsval* vp, PRBool* _retval) {
  nsresult rv = NS_OK;

  JSString* property = JS_ValueToString(cx, id);
  if (property == nsnull)
    return NS_ERROR_FAILURE;

  nsCOMPtr<nsISupports> native;
  rv = wrapper->GetNative(getter_AddRefs(native));
  if (NS_FAILED(rv))
    return rv;

  JSObject* innerObj = UnwrapJSObject(native);
  if (innerObj == nsnull)
    return NS_ERROR_FAILURE;

  *_retval = JS_GetUCProperty(cx, innerObj, JS_GetStringChars(property), JS_GetStringLength(property), vp);
  return rv;
}

NS_METHOD abpScriptable::NewResolve(nsIXPConnectWrappedNative* wrapper, JSContext* cx, JSObject* obj, jsval id, PRUint32 flags, JSObject** objp, PRBool* _retval) {
  nsresult rv = NS_OK;
  *_retval = PR_FALSE;

  nsCOMPtr<nsISupports> native;
  rv = wrapper->GetNative(getter_AddRefs(native));
  if (NS_FAILED(rv))
    return rv;

  JSObject* innerObj = UnwrapJSObject(native);
  if (innerObj == nsnull)
    return NS_ERROR_FAILURE;

  *objp = innerObj;
  *_retval = PR_TRUE;

  return NS_OK;
}

NS_METHOD abpScriptable::PreCreate(nsISupports* nativeObj, JSContext* cx, JSObject* globalObj, JSObject** parentObj) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_METHOD abpScriptable::Create(nsIXPConnectWrappedNative* wrapper, JSContext* cx, JSObject* obj) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_METHOD abpScriptable::PostCreate(nsIXPConnectWrappedNative* wrapper, JSContext* cx, JSObject* obj) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_METHOD abpScriptable::AddProperty(nsIXPConnectWrappedNative* wrapper, JSContext* cx, JSObject* obj, jsval id, jsval* vp, PRBool* _retval) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_METHOD abpScriptable::DelProperty(nsIXPConnectWrappedNative* wrapper, JSContext* cx, JSObject* obj, jsval id, jsval* vp, PRBool* _retval) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_METHOD abpScriptable::SetProperty(nsIXPConnectWrappedNative* wrapper, JSContext* cx, JSObject* obj, jsval id, jsval* vp, PRBool* _retval) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_METHOD abpScriptable::Enumerate(nsIXPConnectWrappedNative* wrapper, JSContext* cx, JSObject* obj, PRBool* _retval) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_METHOD abpScriptable::NewEnumerate(nsIXPConnectWrappedNative* wrapper, JSContext* cx, JSObject* obj, PRUint32 enum_op, jsval* statep, jsid* idp, PRBool* _retval) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_METHOD abpScriptable::Convert(nsIXPConnectWrappedNative* wrapper, JSContext* cx, JSObject* obj, PRUint32 type, jsval* vp, PRBool* _retval) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_METHOD abpScriptable::Finalize(nsIXPConnectWrappedNative* wrapper, JSContext* cx, JSObject* obj) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_METHOD abpScriptable::CheckAccess(nsIXPConnectWrappedNative* wrapper, JSContext* cx, JSObject* obj, jsval id, PRUint32 mode, jsval* vp, PRBool* _retval) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_METHOD abpScriptable::Call(nsIXPConnectWrappedNative* wrapper, JSContext* cx, JSObject* obj, PRUint32 argc, jsval* argv, jsval* vp, PRBool* _retval) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_METHOD abpScriptable::Construct(nsIXPConnectWrappedNative* wrapper, JSContext* cx, JSObject* obj, PRUint32 argc, jsval* argv, jsval* vp, PRBool* _retval) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_METHOD abpScriptable::HasInstance(nsIXPConnectWrappedNative* wrapper, JSContext* cx, JSObject* obj, jsval val, PRBool* bp, PRBool* _retval) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_METHOD abpScriptable::Mark(nsIXPConnectWrappedNative* wrapper, JSContext* cx, JSObject* obj, void* arg, PRUint32* _retval) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_METHOD abpScriptable::Equality(nsIXPConnectWrappedNative* wrapper, JSContext* cx, JSObject* obj, jsval val, PRBool* _retval) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_METHOD abpScriptable::OuterObject(nsIXPConnectWrappedNative* wrapper, JSContext* cx, JSObject* obj, JSObject** _retval) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_METHOD abpScriptable::InnerObject(nsIXPConnectWrappedNative* wrapper, JSContext* cx, JSObject* obj, JSObject** _retval) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
