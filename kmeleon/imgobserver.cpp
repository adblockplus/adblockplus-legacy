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
 
nsCOMPtr<abpImgObserver> imgObserver = new abpImgObserver();

NS_IMPL_ISUPPORTS2(abpImgObserver, imgIDecoderObserver, imgIContainerObserver)

/**************************************
 * imgIDecoderObserver implementation *
 **************************************/

nsresult abpImgObserver::OnStopFrame(imgIRequest* aRequest, gfxIImageFrame *aFrame)
{
  nsresult rv;

  PRInt32 width;
  rv = aFrame->GetWidth(&width);
  if (NS_FAILED(rv))
    return rv;

  PRInt32 height;
  rv = aFrame->GetHeight(&height);
  if (NS_FAILED(rv))
    return rv;

  PRUint8* imageBits;
  PRUint32 dataSize;
  rv = aFrame->GetImageData(&imageBits, &dataSize);
  if (NS_FAILED(rv))
    return rv;
  if (dataSize < (PRUint32)width * height * 4)
    return NS_ERROR_UNEXPECTED;

  HDC hDC = ::GetDC(NULL);

  BITMAPINFOHEADER head;
  head.biSize = sizeof(head);
  head.biWidth = width;
  head.biHeight = height / 3;
  head.biPlanes = 1;
  head.biBitCount = 32;
  head.biCompression = BI_RGB;
  head.biSizeImage = dataSize / 3;
  head.biXPelsPerMeter = 0;
  head.biYPelsPerMeter = 0;
  head.biClrUsed = 0;
  head.biClrImportant = 0;

  for (int i = 2; i >= 0; i--)
  {
    HBITMAP image = ::CreateDIBitmap(hDC, reinterpret_cast<CONST BITMAPINFOHEADER*>(&head),
                                     CBM_INIT, imageBits + i * head.biSizeImage,
                                     reinterpret_cast<CONST BITMAPINFO*>(&head),
                                     DIB_RGB_COLORS);
    ImageList_Add(hImages, image, NULL);
    DeleteObject(image);
  }

  ReleaseDC(NULL, hDC);

  DoneLoadingImage();

  return NS_OK;
}

nsresult abpImgObserver::OnStartRequest(imgIRequest* aRequest) {
  return NS_OK;
}
nsresult abpImgObserver::OnStartDecode(imgIRequest* aRequest) {
  return NS_OK;
}
nsresult abpImgObserver::OnStartContainer(imgIRequest* aRequest, imgIContainer *aContainer) {
  return NS_OK;
}
nsresult abpImgObserver::OnStartFrame(imgIRequest* aRequest, gfxIImageFrame *aFrame) {
  return NS_OK;
}
nsresult abpImgObserver::OnDataAvailable(imgIRequest *aRequest, gfxIImageFrame *aFrame, const nsIntRect * aRect) {
  return NS_OK;
}
nsresult abpImgObserver::OnStopContainer(imgIRequest* aRequest, imgIContainer *aContainer) {
  return NS_OK;
}
nsresult abpImgObserver::OnStopDecode(imgIRequest* aRequest, nsresult status, const PRUnichar *statusArg) {
  return NS_OK;
}
nsresult abpImgObserver::OnStopRequest(imgIRequest* aRequest, PRBool aIsLastPart) {
  return NS_OK;
}
nsresult abpImgObserver::FrameChanged(imgIContainer *aContainer, gfxIImageFrame *aFrame, nsIntRect * aDirtyRect) {
  return NS_OK;
}
