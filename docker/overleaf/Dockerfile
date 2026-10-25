FROM sharelatex/sharelatex:6.3.2

# Required by Norte's exported tables and document color definitions.
RUN tlmgr update --self \
    && tlmgr install booktabs xcolor \
    && tlmgr path add
