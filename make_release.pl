#!/usr/bin/perl

use strict;

die "Version number not specified" unless @ARGV;

my @remove = ();
my @add = ();

my $version = $ARGV[0];
$version =~ s/[^\w\.]//gs;

open(VERSION, ">version");
print VERSION $ARGV[0];
close(VERSION);

@ARGV = ("../downloads/adblockplus-$version.xpi");
do 'create_xpi.pl';
push @add, qq(downloads/adblockplus-$version.xpi);

opendir(LOCALES, "chrome/locale");
my @locales = grep {!/[^\w\-]/ && !/CVS/} readdir(LOCALES);
closedir(LOCALES);

# Remove old single-locale builds
opendir(DOWNLOADS, "../downloads");
map {
  if (tr/-// > 1)
  {
    unlink("../downloads/$_");
    push @remove, qq(downloads/$_);
  }
} readdir(DOWNLOADS);
closedir(DOWNLOADS);

# Create new single-locale builds
for my $locale (@locales)
{
  @ARGV = ("../downloads/adblockplus-$version-$locale.xpi", $locale);
  do 'create_xpi.pl';
  push @add, qq(downloads/adblockplus-$version-$locale.xpi);
}

chdir('..');
system("cvs remove @remove") if @remove;
system("cvs add @add") if @add;
system(qq(cvs commit -m "Releasing Adblock Plus $version"));
