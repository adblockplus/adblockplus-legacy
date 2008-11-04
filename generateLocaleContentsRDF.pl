#!/usr/bin/perl

#############################################################################
# This script will automatically create a contents.rdf file in each locale. #
#############################################################################

use strict;
use warnings;

opendir(local *DIR, "chrome/locale") or die "Could not open directory chrome/locale";
foreach my $locale (readdir(DIR))
{
  next if $locale =~ /[^\w\-]/;

  writeFile("chrome/locale/$locale/contents.rdf", <<EOT);
<?xml version="1.0"?>
<RDF:RDF xmlns:RDF="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
         xmlns:chrome="http://www.mozilla.org/rdf/chrome#">

  <RDF:Seq about="urn:mozilla:locale:root">
    <RDF:li resource="urn:mozilla:locale:$locale"/>
  </RDF:Seq>

  <RDF:Description about="urn:mozilla:locale:$locale">
    <chrome:packages>
      <RDF:Seq about="urn:mozilla:locale:$locale:packages">
        <RDF:li resource="urn:mozilla:locale:$locale:adblockplus"/>
      </RDF:Seq>
    </chrome:packages>
  </RDF:Description>
</RDF:RDF>
EOT
}
closedir(DIR);

sub writeFile
{
  my ($file, $contents) = @_;

  open(local *FILE, ">", $file) || die "Could not write file '$file'";
  binmode(FILE);
  print FILE $contents;
  close(FILE);
}
