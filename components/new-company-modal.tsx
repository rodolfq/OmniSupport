'use client';

import React, { useState } from 'react';
import { X, Building2, Phone, Briefcase } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { saveCompany } from '@/app/actions';
import { Company } from '@/lib/mock-db';
import { maskPhone } from '@/lib/utils';

import { v4 as uuidv4 } from 'uuid';

export function NewCompanyModal({ isOpen, onClose, onSuccess, company }: { isOpen: boolean, onClose: () => void, onSuccess?: () => void, company?: Company | null }) {
  const [name, setName] = useState('');
  const [industry, setIndustry] = useState('');
  const [phone, setPhone] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Update input fields when company prop changes
  React.useEffect(() => {
    if (company) {
      setName(company.name || '');
      setIndustry(company.industry || '');
      setPhone(company.phone || '');
    } else {
      setName('');
      setIndustry('');
      setPhone('');
    }
  }, [company, isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setIsLoading(true);
    
    try {
      const result = await saveCompany(company?.id || null, name, industry, phone);
      
      if (result.error) {
        throw new Error(result.error);
      }
      
      if (onSuccess) onSuccess();
      
      onClose();
      if (!company) {
        setName('');
        setIndustry('');
        setPhone('');
      }
    } catch (e: any) {
      console.error('Error saving company:', e);
      setErrorMsg(e.message || 'Erro inesperado ao salvar empresa.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="relative bg-white w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden border border-slate-200"
          >
            <div className="bg-slate-900 px-8 py-6 text-white flex items-center justify-between">
              <div>
                <h3 className="text-xl font-black tracking-tight text-white m-0">{company ? 'Editar Empresa' : 'Nova Empresa'}</h3>
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">{company ? 'Atualize os dados da organizaÃ§Ã£o' : 'Cadastre uma nova organizaÃ§Ã£o parceira'}</p>
              </div>
              <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-xl transition-colors text-slate-400 hover:text-white">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-8 space-y-5">
              {errorMsg && (
                <div className="bg-red-50 border border-red-200 text-red-600 rounded-xl p-4 text-sm font-medium">
                  {errorMsg}
                </div>
              )}
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Nome da Empresa</label>
                <div className="relative">
                   <Building2 className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                   <input 
                    type="text" 
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="RazÃ£o social ou nome fantasia"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-12 pr-4 py-3 text-sm font-medium focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Setor / IndÃºstria</label>
                  <div className="relative">
                    <Briefcase className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                    <input 
                      type="text" 
                      value={industry}
                      onChange={(e) => setIndustry(e.target.value)}
                      placeholder="Ex: Tecnologia"
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-12 pr-4 py-3 text-sm font-medium focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Telefone Principal</label>
                  <div className="relative">
                    <Phone className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                    <input 
                      type="text" 
                      value={maskPhone(phone)}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="(xx) xxxx-xxxx"
                      maxLength={15}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-12 pr-4 py-3 text-sm font-medium focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all"
                    />
                  </div>
                </div>
              </div>

              <div className="pt-4 flex gap-4">
                <button 
                  type="button" 
                  onClick={onClose}
                  disabled={isLoading}
                  className="flex-1 px-6 py-3.5 rounded-xl text-sm font-bold text-slate-500 hover:bg-slate-50 transition-all border border-slate-200 disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button 
                  type="submit"
                  disabled={isLoading}
                  className="flex-1 bg-indigo-600 text-white px-6 py-3.5 rounded-xl text-sm font-black uppercase tracking-widest shadow-lg shadow-indigo-100 hover:bg-indigo-700 transition-all flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
                >
                  {isLoading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Processando...
                    </>
                  ) : (
                    <>
                      {company ? 'Salvar' : 'Cadastrar'} <Building2 size={16} />
                    </>
                  )}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}


