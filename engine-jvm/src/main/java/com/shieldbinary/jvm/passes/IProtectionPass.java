package com.shieldbinary.jvm.passes;

import com.shieldbinary.jvm.PipelineContext;

public interface IProtectionPass {
    String getName();
    void run(PipelineContext ctx) throws Exception;
}
