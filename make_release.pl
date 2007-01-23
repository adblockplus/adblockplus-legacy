#!/usr/bin/perl

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
my @locales = grep {!/[^\w\-]/ && !/CVS/} readdir(LOCALES);
closedir(LOCALES);

# Create new single-locale builds
for my $locale (@locales)
{
  @ARGV = ("../downloads/adblockplus-$version-$locale.xpi", $locale);
  do './create_xpi.pl';
}

chdir('..');
system("cvs add downloads/adblockplus-$version.xpi");
system(qq(cvs commit -m "Releasing Adblock Plus $version"));
