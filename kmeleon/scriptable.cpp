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

/***********************************
 * nsIXPCScriptable implementation *
 ***********************************/

NS_METHOD abpWrapper::GetClassName(char** retval) {
  NS_ENSURE_ARG_POINTER(retval);

  *retval = "abpWrapper";

  return NS_OK;
}

NS_METHOD abpWrapper::GetScriptableFlags(PRUint32* retval) {
  NS_ENSURE_ARG_POINTER(retval);

  *retval = nsIXPCScriptable::WANT_GETPROPERTY | nsIXPCScriptable::WANT_NEWRESOLVE;

  return NS_OK;
}

NS_METHOD abpWrapper::GetProperty(nsIXPConnectWrappedNative* wrapper, JSContext* cx, JSObject* obj, jsval id, jsval* vp, PRBool* _retval) {
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

  if (!JS_GetUCProperty(cx, innerObj, JS_GetStringChars(property), JS_GetStringLength(property), vp))
    return NS_ERROR_FAILURE;

  return rv;
}

NS_METHOD abpWrapper::NewResolve(nsIXPConnectWrappedNative* wrapper, JSContext* cx, JSObject* obj, jsval id, PRUint32 flags, JSObject** objp, PRBool* _retval) {
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

NS_METHOD abpWrapper::PreCreate(nsISupports* nativeObj, JSContext* cx, JSObject* globalObj, JSObject** parentObj) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_METHOD abpWrapper::Create(nsIXPConnectWrappedNative* wrapper, JSContext* cx, JSObject* obj) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_METHOD abpWrapper::PostCreate(nsIXPConnectWrappedNative* wrapper, JSContext* cx, JSObject* obj) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_METHOD abpWrapper::AddProperty(nsIXPConnectWrappedNative* wrapper, JSContext* cx, JSObject* obj, jsval id, jsval* vp, PRBool* _retval) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_METHOD abpWrapper::DelProperty(nsIXPConnectWrappedNative* wrapper, JSContext* cx, JSObject* obj, jsval id, jsval* vp, PRBool* _retval) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_METHOD abpWrapper::SetProperty(nsIXPConnectWrappedNative* wrapper, JSContext* cx, JSObject* obj, jsval id, jsval* vp, PRBool* _retval) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_METHOD abpWrapper::Enumerate(nsIXPConnectWrappedNative* wrapper, JSContext* cx, JSObject* obj, PRBool* _retval) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_METHOD abpWrapper::NewEnumerate(nsIXPConnectWrappedNative* wrapper, JSContext* cx, JSObject* obj, PRUint32 enum_op, jsval* statep, jsid* idp, PRBool* _retval) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_METHOD abpWrapper::Convert(nsIXPConnectWrappedNative* wrapper, JSContext* cx, JSObject* obj, PRUint32 type, jsval* vp, PRBool* _retval) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_METHOD abpWrapper::Finalize(nsIXPConnectWrappedNative* wrapper, JSContext* cx, JSObject* obj) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_METHOD abpWrapper::CheckAccess(nsIXPConnectWrappedNative* wrapper, JSContext* cx, JSObject* obj, jsval id, PRUint32 mode, jsval* vp, PRBool* _retval) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_METHOD abpWrapper::Call(nsIXPConnectWrappedNative* wrapper, JSContext* cx, JSObject* obj, PRUint32 argc, jsval* argv, jsval* vp, PRBool* _retval) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_METHOD abpWrapper::Construct(nsIXPConnectWrappedNative* wrapper, JSContext* cx, JSObject* obj, PRUint32 argc, jsval* argv, jsval* vp, PRBool* _retval) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_METHOD abpWrapper::HasInstance(nsIXPConnectWrappedNative* wrapper, JSContext* cx, JSObject* obj, jsval val, PRBool* bp, PRBool* _retval) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_METHOD abpWrapper::Mark(nsIXPConnectWrappedNative* wrapper, JSContext* cx, JSObject* obj, void* arg, PRUint32* _retval) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_METHOD abpWrapper::Equality(nsIXPConnectWrappedNative* wrapper, JSContext* cx, JSObject* obj, jsval val, PRBool* _retval) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_METHOD abpWrapper::OuterObject(nsIXPConnectWrappedNative* wrapper, JSContext* cx, JSObject* obj, JSObject** _retval) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_METHOD abpWrapper::InnerObject(nsIXPConnectWrappedNative* wrapper, JSContext* cx, JSObject* obj, JSObject** _retval) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
