#!/usr/bin/perl

# This is a dummy, its purpose is to call a script with the same name in the parent directory

$0 =~ s/(.*[\\\/])//g;
chdir($1) if $1;
do "../$0";
