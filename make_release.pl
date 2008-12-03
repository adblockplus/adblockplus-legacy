#!/usr/bin/perl

#############################################################################
# This is the release automation script, it will change current extension   #
# version, create release builds and commit it all into Mercurial. Usually  #
# you just want to create a build - use make_devbuild.pl for this.          #
#############################################################################

use strict;

die "Version number not specified" unless @ARGV;

my $version = $ARGV[0];
$version =~ s/[^\w\.]//gs;

open(VERSION, ">version");
print VERSION $ARGV[0];
close(VERSION);

@ARGV = ("../downloads/adblockplus-$version.xpi");
do './create_xpi.pl';

opendir(LOCALES, "chrome/locale");
my @locales = grep {!/[^\w\-]/ && !-e("chrome/locale/$_/.incomplete")} readdir(LOCALES);
closedir(LOCALES);

# Create new single-locale builds
for my $locale (@locales)
{
  @ARGV = ("../downloads/adblockplus-$version-$locale.xpi", $locale);
  do './create_xpi.pl';
}

chdir('..');
system("hg add downloads/adblockplus-$version.xpi");
system(qq(hg commit -m "Releasing Adblock Plus $version" downloads src));

my $branch = $version;
$branch =~ s/\./_/g;
$branch = "ADBLOCK_PLUS_".$branch."_RELEASE";
system(qq(hg tag $branch));

system(qq(hg push));
